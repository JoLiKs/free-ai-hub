/* Сетевой слой: запросы к провайдерам, потоковый разбор SSE, «размышления», таймауты, повторы, очередь. */
import { abortError } from './util.js';
import { limiterFor, QueueWaitError } from './limiter.js';
export { QueueWaitError };

/* ------------------------------ ошибки -------------------------------- */
export class HttpError extends Error {
  constructor(status, msg, retryAfter, body) { super(msg || ('HTTP ' + status)); this.name = 'HttpError'; this.status = status; this.retryAfter = retryAfter; this.body = body; }
}
export class TimeoutError extends Error { constructor(msg, phase) { super(msg); this.name = 'TimeoutError'; this.phase = phase; } }
export class StreamError extends Error { constructor(msg, extra) { super(msg); this.name = 'StreamError'; if (extra) Object.assign(this, extra); } }

export async function httpError(res) {
  let msg = '', txt = '';
  try {
    txt = await res.text();
    try {
      const j = JSON.parse(txt);
      const e = j.error !== undefined ? j.error : (j.detail !== undefined ? j.detail : j.message);
      msg = typeof e === 'string' ? e : (e && (e.message || e.error)) ? String(e.message || e.error) : (e ? JSON.stringify(e) : '');
    } catch { msg = txt.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240); }
  } catch { /* тело недоступно */ }
  let ra = parseFloat(res.headers.get('retry-after'));
  if (isNaN(ra)) { const rr = parseFloat(res.headers.get('ratelimit-reset') || res.headers.get('x-ratelimit-reset')); if (!isNaN(rr) && rr < 3600) ra = rr; }
  return new HttpError(res.status, msg.slice(0, 300), isNaN(ra) ? undefined : ra, txt.slice(0, 500));
}

/** Человекочитаемое объяснение ошибки (по-русски) */
export function explainError(e, p) {
  p = p || {};
  if (!e) return 'Неизвестная ошибка.';
  if (e.name === 'AbortError') return 'Запрос остановлен.';
  if (e instanceof TimeoutError) return e.phase === 'idle' ? 'Провайдер перестал отдавать данные (таймаут). Попробуйте ещё раз или другую модель.' : 'Провайдер не ответил вовремя (таймаут). Сервис перегружен — повторите позже или выберите другую модель.';
  if (e instanceof StreamError) return e.message;
  if (e instanceof HttpError) {
    const d = e.message && !/^HTTP \d+$/.test(e.message) ? ` («${e.message}»)` : '';
    const s = e.status;
    if (s === 401) return p.keyMode === 'required' ? `401 — нужен API-ключ или он неверный${d}. Добавьте ключ в блоке «Свой ключ» или выберите провайдера без ключа.` : `401 — эта модель недоступна без ключа${d}. Выберите другую модель.`;
    if (s === 402) return p.id === 'pollinations' ? `402 — сработал анонимный лимит Pollinations (~1 запрос / 15 с на IP) или адрес сайта не принят${d}. Подождите и повторите либо выберите другого провайдера.` : `402 — требуется оплата/регистрация у провайдера${d}. Выберите другую модель.`;
    if (s === 403) return `403 — запрос отклонён${d}. ${p.id === 'pollinations' ? 'Pollinations не принимает запросы с этого адреса — выберите другого провайдера.' : 'Проверьте ключ, регион и права доступа.'}`;
    if (s === 404) return `404 — модель или адрес не найдены${d}. Обновите список моделей.`;
    if (s === 400 || s === 422) return `${s} — провайдер не принял запрос${d}. Возможно, слишком длинный диалог или неподдерживаемый параметр (попробуйте «Макс. токенов: авто» и новый чат).`;
    if (s === 406 && p.id === 'horde') return `406 — AI Horde: модель сейчас недоступна у волонтёров или запрос отклонён${d}. Выберите другую модель.`;
    if (s === 408) return `408 — превышено время ожидания на стороне провайдера${d}.`;
    if (s === 413) return `413 — слишком длинный запрос${d}. Начните новый чат или сократите сообщение.`;
    if (s === 429) return `429 — превышен лимит запросов${d}. ${e.retryAfter ? 'Подождите ~' + Math.ceil(e.retryAfter) + ' с' : 'Подождите немного'} или выберите другую модель/провайдера.`;
    if (s === 503) return `503 — модель занята или недоступна${d}. Попробуйте через минуту или другую модель.`;
    if (s >= 500) return `${s} — сервис провайдера временно недоступен${d}. Повторите позже или выберите другую модель.`;
    return `HTTP ${s}${d}`;
  }
  if (e instanceof TypeError && typeof navigator !== 'undefined' && navigator.onLine === false) return 'Нет подключения к интернету. Проверьте сеть и повторите.';
  if (e instanceof TypeError) return 'Сетевая ошибка или блокировка CORS. Проверьте интернет/VPN/блокировщики рекламы; возможно, сервис не разрешает запросы из браузера с этого адреса.';
  return e.message || String(e);
}

/** Стоит ли пробовать другую модель/провайдера после этой ошибки */
export function isFallbackWorthy(e) {
  if (!e || e.name === 'AbortError') return false;
  if (e.name === 'QueueWaitError') return true;
  if (e instanceof HttpError) return ![400, 413, 422].includes(e.status);
  return true;
}

/* ------------------------------ SSE ------------------------------------ */
/** Разбирает SSE-поток. Корректно склеивает события, порезанные на любых границах чанков (в т.ч. посреди UTF-8),
 *  поддерживает CRLF, многострочные data:, комментарии, event:error и [DONE]. onData(str) вызывается на каждое событие. */
export async function readSSE(body, onData, { idleMs = 0, onIdle } = {}) {
  const reader = body.getReader(); const dec = new TextDecoder();
  let buf = '', ev = { event: '', data: [] }, done = false;
  const dispatch = () => {
    if (!ev.data.length && !ev.event) return;
    const data = ev.data.join('\n'); const event = ev.event; ev = { event: '', data: [] };
    if (data === '[DONE]') { done = true; return; }
    if (data === '' && !event) return;
    onData(data, event);
  };
  const handleLine = line => {
    if (line === '') return dispatch();
    if (line.startsWith(':')) return;
    const i = line.indexOf(':');
    const field = i < 0 ? line : line.slice(0, i);
    let val = i < 0 ? '' : line.slice(i + 1); if (val.startsWith(' ')) val = val.slice(1);
    if (field === 'data') {
      // сервер забыл пустую строку между событиями: если накопленное уже валидный JSON — отправим его
      if (ev.data.length && /^\s*[{[]/.test(ev.data[0])) { try { JSON.parse(ev.data.join('\n')); dispatch(); } catch { /* многострочный JSON — продолжаем */ } }
      ev.data.push(val);
    } else if (field === 'event') ev.event = val;
  };
  let timer = null;
  const arm = () => { if (idleMs) { clearTimeout(timer); timer = setTimeout(() => onIdle && onIdle(), idleMs); } };
  try {
    for (;;) {
      arm();
      const { value, done: fin } = await reader.read();
      if (fin) break;
      buf += dec.decode(value, { stream: true });
      let m;
      while ((m = /\r\n|\n|\r/.exec(buf))) {
        if (m[0] === '\r' && m.index === buf.length - 1) break;      // возможно, \r\n разрезан чанком
        const line = buf.slice(0, m.index); buf = buf.slice(m.index + m[0].length);
        handleLine(line);
        if (done) { try { reader.cancel(); } catch { /* */ } return; }
      }
    }
    buf += dec.decode();
    if (buf) handleLine(buf.replace(/\r$/, ''));
    dispatch();
  } finally { clearTimeout(timer); }
}

/* --------------------------- извлечение дельт -------------------------- */
const textOf = c => Array.isArray(c) ? c.map(x => typeof x === 'string' ? x : (x && (x.text || (x.type === 'text' && x.content)) || '')).join('') : (typeof c === 'string' ? c : '');

/** OpenAI-совместимый чанк/ответ → { text, reasoning, finish, usage } ; бросает StreamError при {error} */
export function extractOpenAI(j) {
  if (j && j.error) throw new StreamError('Ошибка потока: ' + (typeof j.error === 'string' ? j.error : (j.error.message || JSON.stringify(j.error))));
  const c = j && j.choices && j.choices[0];
  const out = { text: '', reasoning: '', finish: '', usage: j && j.usage || null };
  if (!c) return out;
  const d = c.delta || c.message || {};
  out.text = textOf(d.content) || (typeof c.text === 'string' ? c.text : '');
  out.reasoning = textOf(d.reasoning_content) || textOf(d.reasoning) || textOf(d.thinking) || '';
  out.finish = c.finish_reason || '';
  return out;
}
export function extractGemini(j) {
  if (j && j.error) throw new StreamError('Ошибка потока: ' + (j.error.message || JSON.stringify(j.error)));
  const parts = (j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
  const cand = j && j.candidates && j.candidates[0];
  const u = j && j.usageMetadata;
  return {
    text: parts.filter(x => !x.thought).map(x => x.text || '').join(''),
    reasoning: parts.filter(x => x.thought).map(x => x.text || '').join(''),
    finish: cand && cand.finishReason || '',
    usage: u ? { prompt_tokens: u.promptTokenCount, completion_tokens: u.candidatesTokenCount } : null
  };
}

/* ----------------------------- запрос ---------------------------------- */
export function authHeaders(p, key) {
  if (!key && p.anonKey) key = p.anonKey;   // публичный анонимный ключ (AI Horde)
  if (!key) return {};
  return p.type === 'gemini' ? { 'x-goog-api-key': key } : { Authorization: 'Bearer ' + key };
}
let proxyBase = '';
/** Необязательный CORS-прокси пользователя (см. proxy/): используется провайдерами с needsProxy */
export function setProxy(url) { proxyBase = String(url || '').trim().replace(/\/+$/, ''); }
export const getProxy = () => proxyBase;
export function baseOf(p, customUrl) {
  if (p.needsProxy) return proxyBase ? proxyBase + p.proxyPath : '';
  return (p.custom ? (customUrl || '') : (p.baseUrl || '')).trim().replace(/\/+$/, '');
}

/** Строит { url, init, extract } для одного запроса чата */
export function buildRequest(p, o) {
  const { model, messages, system, temp, maxTokens, key, customUrl, stream = true } = o;
  const headers = Object.assign({ 'Content-Type': 'application/json' }, authHeaders(p, key));
  if (p.type === 'gemini') {
    const url = `${p.baseUrl}/models/${encodeURIComponent(model)}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;
    const body = {
      contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: Object.assign({ temperature: temp }, maxTokens ? { maxOutputTokens: maxTokens } : {})
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    return { url, init: { method: 'POST', headers, body: JSON.stringify(body) }, extract: extractGemini };
  }
  const base = baseOf(p, customUrl);
  const url = p.chatUrl || base + '/chat/completions';
  const wire = messages.map(m => (m.images && m.images.length)
    ? { role: m.role, content: [{ type: 'text', text: m.content }].concat(m.images.map(u => ({ type: 'image_url', image_url: { url: u } }))) }
    : { role: m.role, content: m.content });
  const all = (system ? [{ role: 'system', content: system }] : []).concat(wire);
  const body = { model, messages: all, stream };
  if (typeof temp === 'number' && !isNaN(temp)) body.temperature = temp;
  if (maxTokens) body.max_tokens = maxTokens;
  return { url, init: { method: 'POST', headers, body: JSON.stringify(body) }, extract: extractOpenAI };
}

/** Один запрос (без повторов). Возвращает { content, reasoning, usage, finish } */
export async function requestOnce(p, o, { signal, onDelta, onReasoning, headerTimeoutMs = 60000, idleTimeoutMs = 60000, fetchImpl } = {}) {
  const rq = buildRequest(p, o);
  const ac = new AbortController(); let timedOut = ''; let timer = null;
  const onAbort = () => ac.abort();
  if (signal) { if (signal.aborted) throw abortError(); signal.addEventListener('abort', onAbort, { once: true }); }
  const fire = phase => { timedOut = phase; ac.abort(); };
  timer = setTimeout(() => fire('headers'), headerTimeoutMs);
  const res_ = { content: '', reasoning: '', usage: null, finish: '' };
  const acc = r => {
    if (r.usage) res_.usage = r.usage;
    if (r.finish) res_.finish = r.finish;
    if (r.reasoning) { res_.reasoning += r.reasoning; onReasoning && onReasoning(r.reasoning); }
    if (r.text) { res_.content += r.text; onDelta && onDelta(r.text); }
  };
  try {
    const res = await (fetchImpl || fetch)(rq.url, Object.assign({}, rq.init, { signal: ac.signal }));
    clearTimeout(timer); timer = null;
    if (!res.ok) throw await httpError(res);
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (res.body && ct.includes('event-stream')) {
      await readSSE(res.body, (data, event) => {
        if (event === 'error') { let m = data; try { const j = JSON.parse(data); m = (j.error && (j.error.message || j.error)) || j.message || data; } catch { /* */ } throw new StreamError('Ошибка потока: ' + m); }
        let j; try { j = JSON.parse(data); } catch { return; }   // мусорная/неполная строка
        acc(rq.extract(j));
      }, { idleMs: idleTimeoutMs, onIdle: () => fire('idle') });
    } else if (res.body && ct.includes('text/plain') && !ct.includes('json')) {
      // голый поток текста
      const reader = res.body.getReader(); const dec = new TextDecoder();
      for (;;) {
        clearTimeout(timer); timer = setTimeout(() => fire('idle'), idleTimeoutMs);
        const { value, done } = await reader.read(); if (done) break;
        acc({ text: dec.decode(value, { stream: true }) });
      }
    } else {
      const txt = await res.text();
      let j; try { j = JSON.parse(txt); } catch { throw new StreamError('Провайдер вернул не JSON: ' + txt.slice(0, 120)); }
      acc(rq.extract(j));
    }
    // финальная проверка
    const answer = res_.content.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();
    if (!answer) {
      if (res_.reasoning || /<think>/.test(res_.content)) throw new StreamError(res_.finish === 'length' ? 'Модель потратила все токены на размышления и не успела ответить. Увеличьте «Макс. токенов» или уберите лимит.' : 'Модель вернула только размышления без ответа. Повторите запрос.', { reasoningOnly: true });
      throw new StreamError('Модель вернула пустой ответ.');
    }
    return res_;
  } catch (e) {
    if (timedOut && (e.name === 'AbortError' || e instanceof TypeError || !(e instanceof HttpError))) throw new TimeoutError('timeout:' + timedOut, timedOut);
    if (signal && signal.aborted) throw abortError();
    if (e instanceof TypeError && (res_.content || res_.reasoning)) throw new StreamError('Соединение с провайдером оборвалось посреди ответа. Нажмите «Заново».');   // не путаем с CORS
    throw e;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

/** Задержка перед повтором (сек) или null, если повторять не нужно */
export function retryDelay(e, attempt, p) {
  const jitter = Math.random() * 1.5;
  if (e instanceof HttpError) {
    const ra = e.retryAfter;
    if (e.status === 429) { const d = ra != null ? ra + 1 : (p.id === 'ovh' ? 31 : 6 * Math.pow(2, attempt)); return d <= 70 ? d : null; }
    if (e.status === 402 && p.id === 'pollinations') return 16 + jitter;
    if (e.status === 503 || e.status === 502 || e.status === 504) { const d = ra != null ? ra + 1 : 3 * Math.pow(2, attempt) + jitter; return d <= 40 ? d : null; }
    if (e.status === 406 && /per 1 second|rate|too many/i.test(e.message)) return 2 + jitter;
    if (e.status === 406 && p.id === 'horde' && /not enough generations/i.test(e.message)) return 4 + jitter;   // разовый отказ анонимного ключа — обычно проходит со 2-й попытки
    return null;
  }
  if (e instanceof TypeError && attempt === 0) return 2;
  return null;
}

export const MAX_ATTEMPTS = 3;

/**
 * Полный цикл: очередь провайдера → запрос → повторы с backoff и видимым обратным отсчётом.
 * onStatus({type:'queue'|'wait'|'retry'|'slow'|'clear', text, seconds})
 */
export async function chat(p, o, { signal, onDelta, onReasoning, onStatus, maxAttempts = MAX_ATTEMPTS, fetchImpl, maxWaitMs } = {}) {
  const lim = limiterFor(p);
  const st = onStatus || (() => {});
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const release = await lim.acquire(o.model, {
      signal, maxWaitMs,
      onWait: (sec, reason) => {
        if (!reason) return st({ type: 'clear' });
        const why = { penalty: 'Лимит провайдера', rate: 'Лимит запросов провайдера', gap: 'Пауза между запросами', busy: 'Очередь провайдера' }[reason] || 'Ожидание';
        st({ type: 'wait', seconds: sec, text: sec == null ? `${why}: ждём освобождения слота…` : `${why}: ждём ${sec} с…` });
      }
    });
    let started = false;
    try {
      st({ type: 'clear' });
      if (p.slowNote) st({ type: 'slow', text: p.slowNote });
      const r = await requestOnce(p, o, {
        signal, fetchImpl,
        onDelta: t => { if (!started) { started = true; st({ type: 'clear' }); } onDelta && onDelta(t); },
        onReasoning: t => { if (!started) st({ type: 'thinking', text: 'модель размышляет…' }); onReasoning && onReasoning(t); },
        headerTimeoutMs: p.timeoutMs || 60000, idleTimeoutMs: p.timeoutMs ? Math.min(p.timeoutMs, 120000) : 60000
      });
      release(); return r;
    } catch (e) {
      release();
      if (e.name === 'AbortError') throw e;
      lastErr = e;
      if (started) throw e;                       // часть ответа уже показана — не повторяем
      const d = attempt < maxAttempts - 1 ? retryDelay(e, attempt, p) : null;
      if (d == null) throw e;
      st({ type: 'retry', text: `Ошибка ${e.status || 'сети'} — повтор ${attempt + 2}/${maxAttempts}…` });
      lim.penalize(p.limits && p.limits.rate && p.limits.rate.per === 'model' ? o.model : null, d * 1000);
    }
  }
  throw lastErr;
}
