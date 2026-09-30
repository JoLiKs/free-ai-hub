/* Списки моделей (кэш с TTL, «устаревшее показываем сразу — обновляем в фоне»),
 * проверка доступности («живая проверка») и избранное. */
import { store as defaultStore } from './store.js';
import { authHeaders, baseOf, httpError, explainError, HttpError, TimeoutError, chat } from './api.js';
import { limiterFor } from './limiter.js';

export const MODELS_TTL = 6 * 3600e3;
export const HEALTH_FRESH = 30 * 60e3;     // «свежая» проверка
export const HEALTH_STALE = 6 * 3600e3;    // старше — считаем устаревшей

export const norm = m => typeof m === 'string' ? { id: m, label: m, meta: '' } : Object.assign({ meta: '' }, m, { label: m.label || m.id });

export function staticModels(p) {
  return (p.staticModels || []).map(norm).map(m => decorate(p, m));
}
export function decorate(p, m) {
  const note = p.flaky && p.flaky[m.id];
  return note ? Object.assign({}, m, { flaky: note }) : m;
}
export function modelsUrlFor(p, customUrl) {
  if (p.modelsUrl) return p.modelsUrl;
  const base = baseOf(p, customUrl);
  return p.type === 'gemini' ? base + '/models?pageSize=1000' : base + '/models';
}

/** Ключ кэша зависит от наличия ключа/своего URL (списки различаются) */
const cacheKey = (p, key, customUrl) => 'models.' + p.id + (p.custom ? '.' + (customUrl || '') : '') + (key ? '.k' : '');

export async function fetchLive(p, { key, customUrl, fetchImpl, signal } = {}) {
  const f = fetchImpl || fetch;
  const res = await f(modelsUrlFor(p, customUrl), { headers: authHeaders(p, key), signal });
  if (!res.ok) throw await httpError(res);
  const json = await res.json();
  let list = p.parseModels ? p.parseModels(json, key) : (json.data || []).map(m => ({ id: m.id, label: m.id, meta: '' }));
  list = list.map(norm);
  if (!list.length) throw new Error('Провайдер вернул пустой список моделей.');
  // AI Horde и подобные: наложим живую статистику
  if (p.statusUrl && p.applyStatus) {
    try { const r = await f(p.statusUrl, { signal }); if (r.ok) list = p.applyStatus(list, await r.json()); } catch { /* статистика — необязательна */ }
  }
  return list.map(m => decorate(p, m));
}

/**
 * Возвращает { list, source: 'live'|'cache'|'static', ts, error?, stale? }.
 * onUpdate(result) вызывается, если после отдачи кэша фоновое обновление принесло новый список.
 */
export async function getModels(p, { key = '', customUrl = '', force = false, store = defaultStore, fetchImpl, onUpdate, now = Date.now } = {}) {
  const fb = staticModels(p);
  if (p.noModelsEndpoint || p.type === 'local') return { list: fb, source: 'static', ts: 0 };
  if (p.needsProxy && !baseOf(p)) return { list: fb, source: 'static', ts: 0, error: 'Нужен свой CORS-прокси: разверните proxy/worker.js и укажите адрес в «Настройки → CORS-прокси».' };
  if (p.custom && !customUrl.trim()) return { list: [], source: 'static', ts: 0, error: 'Укажите Base URL своего эндпоинта в блоке «Свой ключ».' };
  if (p.keyMode === 'required' && p.modelsNeedKey !== false && !key) return { list: fb, source: 'static', ts: 0, error: 'Для списка моделей этого провайдера нужен API-ключ (можно пользоваться провайдерами без ключа).' };
  const ck = cacheKey(p, key, customUrl);
  const cached = store.get(ck, null);
  const fresh = cached && now() - cached.ts < MODELS_TTL;
  if (!force && cached && cached.list && cached.list.length) {
    const list = cached.list.map(m => decorate(p, m));
    if (!fresh && onUpdate) {
      fetchLive(p, { key, customUrl, fetchImpl }).then(l => { store.set(ck, { ts: now(), list: l }); onUpdate({ list: l, source: 'live', ts: now() }); }).catch(() => { /* остаёмся на кэше */ });
    }
    return { list, source: 'cache', ts: cached.ts, stale: !fresh };
  }
  try {
    const list = await fetchLive(p, { key, customUrl, fetchImpl });
    store.set(ck, { ts: now(), list });
    return { list, source: 'live', ts: now() };
  } catch (e) {
    const list = (cached && cached.list) ? cached.list.map(m => decorate(p, m)) : fb;
    return { list, source: cached ? 'cache' : 'static', ts: cached ? cached.ts : 0, error: `Не удалось загрузить список моделей: ${explainError(e, p)}${list.length ? ' Показан ' + (cached ? 'сохранённый' : 'встроенный') + ' список.' : ''}`, stale: true };
  }
}

/* ------------------------------ избранное ------------------------------ */
export const favs = {
  get(store = defaultStore) { return new Set(store.get('favs', [])); },
  has(pid, mid, store = defaultStore) { return this.get(store).has(pid + '|' + mid); },
  toggle(pid, mid, store = defaultStore) { const s = this.get(store); const k = pid + '|' + mid; if (s.has(k)) s.delete(k); else s.add(k); store.set('favs', [...s]); return s.has(k); }
};

/* --------------------------- проверка доступности ---------------------- */
export const healthStore = {
  all(store = defaultStore) { return store.get('health', {}); },
  get(pid, mid, store = defaultStore) { return this.all(store)[pid + '|' + mid] || null; },
  set(pid, mid, rec, store = defaultStore) { const a = this.all(store); a[pid + '|' + mid] = rec; store.set('health', a); },
  clear(store = defaultStore) { store.del('health'); }
};

/** Классификация результата проверки → 'ok' | 'limited' | 'flaky' | 'fail' */
export function classify(err, ms) {
  if (!err) return ms > 20000 ? { s: 'flaky', note: 'отвечает очень медленно (' + Math.round(ms / 1000) + ' с)' } : { s: 'ok' };
  if (err instanceof HttpError) {
    if (err.status === 429) return { s: 'limited', note: 'работает, но упирается в лимит запросов' };
    if (err.status === 402) return { s: 'flaky', note: '402: лимит/оплата — работает не всегда' };
    if (err.status === 503 || err.status === 502 || err.status === 504 || err.status === 408) return { s: 'flaky', note: err.status + ': модель занята/перегружена' };
    if (err.status === 401 || err.status === 403) return { s: 'fail', note: err.status + ': требуется ключ или доступ закрыт' };
    if (err.status === 404) return { s: 'fail', note: '404: модели нет' };
    return { s: 'fail', note: 'HTTP ' + err.status + (err.message ? ': ' + err.message.slice(0, 80) : '') };
  }
  if (err && err.reasoningOnly) return { s: 'ok', note: 'reasoning-модель: отвечает (думает долго)' };
  if (err instanceof TimeoutError) return { s: 'flaky', note: 'таймаут' };
  if (err instanceof TypeError) return { s: 'fail', note: 'сеть/CORS' };
  return { s: 'fail', note: (err.message || 'ошибка').slice(0, 100) };
}

/** Проверяет одну модель крошечным запросом. Результат сохраняется в кэш. */
export async function checkModel(p, mid, { key, customUrl, signal, store = defaultStore, fetchImpl, now = Date.now, maxAttempts = 1 } = {}) {
  const t0 = now();
  let err = null, waited = false;
  try {
    await chat(p, { model: mid, messages: [{ role: 'user', content: 'Ответь одним словом: ок' }], temp: 0, maxTokens: 200, key, customUrl }, { signal, maxAttempts, fetchImpl, onStatus: st => { if (st.type === 'wait' || st.type === 'retry') waited = true; } });
  } catch (e) { if (e.name === 'AbortError') throw e; err = e; }
  const ms = now() - t0;
  // время ожидания лимита/повторов не считаем «медленным ответом»
  const c = classify(err, waited ? Math.min(ms, 20000) : ms);
  const rec = { s: c.s, ts: now(), ms, note: c.note || '' };
  healthStore.set(p.id, mid, rec, store);
  return rec;
}

/** Проверка списка моделей провайдера: по одной (очередь провайдера сама соблюдает лимиты). */
export async function checkProvider(p, list, { key, customUrl, signal, onProgress, store = defaultStore, fetchImpl, statusOnly, maxAttempts = 1 } = {}) {
  const out = {}; let i = 0;
  if (p.statusUrl && p.applyStatus) {
    // AI Horde: не нагружаем волонтёров — берём статус очередей
    try {
      const f = fetchImpl || fetch; const r = await f(p.statusUrl, { signal });
      const status = r.ok ? await r.json() : [];
      const by = new Map(status.map(s => [s.name, s]));
      for (const m of list) {
        const s = by.get(m.id); let rec;
        if (!s || !s.count) rec = { s: 'fail', ts: Date.now(), ms: 0, note: 'нет волонтёров онлайн' };
        else if (s.eta > 90) rec = { s: 'flaky', ts: Date.now(), ms: s.eta * 1000, note: `очередь ≈ ${s.eta} с` };
        else rec = { s: 'ok', ts: Date.now(), ms: s.eta * 1000, note: `${s.count} волонтёр(ов), очередь ≈ ${s.eta} с` };
        healthStore.set(p.id, m.id, rec, store); out[m.id] = rec; onProgress && onProgress(++i, list.length, m.id, rec);
      }
    } catch (e) { if (e.name === 'AbortError') throw e; }
    return out;
  }
  const queue = list.slice(); const par = Math.max(1, Math.min(3, (p.limits && p.limits.concurrency) || 1));
  const worker = async () => {
    while (queue.length && !(signal && signal.aborted)) {
      const m = queue.shift();
      const rec = await checkModel(p, m.id, { key, customUrl, signal, store, fetchImpl, maxAttempts });
      out[m.id] = rec; onProgress && onProgress(++i, list.length, m.id, rec);
    }
  };
  await Promise.all(Array.from({ length: par }, worker));
  return out;
}

export const healthLabel = s => ({ ok: 'работает', limited: 'работает (лимит)', flaky: 'нестабильно', fail: 'не работает' }[s] || 'не проверялось');

/** Сводка по провайдеру для карточки: {ok, total, checked, ts} */
export function providerSummary(p, list, store = defaultStore, now = Date.now) {
  let ok = 0, checked = 0, ts = 0;
  for (const m of list) {
    const h = healthStore.get(p.id, m.id, store);
    if (!h) continue; checked++; if (h.s === 'ok' || h.s === 'limited') ok++; if (h.ts > ts) ts = h.ts;
  }
  return { ok, total: list.length, checked, ts, stale: ts && now() - ts > HEALTH_STALE };
}

/** Сколько мс до возможного старта запроса к модели (для выбора запасного варианта) */
export function peekDelay(p, model) { return limiterFor(p).delayFor({ model }).ms; }
