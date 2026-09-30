/* Журнал чата на сервере владельца (необязательный, только с согласием пользователя).
 *
 * Что уходит: session_id (случайный UUID из localStorage), chat_id, провайдер и модель, текст вопроса и ответа,
 *   время, язык интерфейса. Что НЕ уходит никогда: API-ключи, Base URL своего эндпоинта, URL прокси, системный промпт,
 *   вложенные картинки, настройки. Если пользователь вставил в чат свой сохранённый ключ — он вырезается из текста.
 * Если BACKEND_URL пуст или согласия нет — не делает ничего. Любая ошибка сети молча игнорируется и не блокирует чат.
 * Модуль не обращается к DOM на верхнем уровне (тестируется в Node). */
import { store as defaultStore } from './store.js';

export const MAX_TEXT = 20000;
const KEEPALIVE_LIMIT = 60000;      // fetch keepalive ограничен ~64 КиБ тела

export function normalizeBackendUrl(u) {
  u = String(u || '').trim().replace(/\/+$/, '');
  if (!u) return '';
  if (/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(u) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(u)) return u;
  return '';                        // неверный/небезопасный адрес = журнал выключен
}

export function newUuid(c = globalThis.crypto) {
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && c.getRandomValues) c.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function redact(text, secrets) {
  let t = String(text == null ? '' : text);
  for (const s of secrets || []) if (typeof s === 'string' && s.length >= 8) t = t.split(s).join('[ключ скрыт]');
  return t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) : t;
}

export function createTelemetry({
  backendUrl, store = defaultStore, fetchFn = globalThis.fetch && globalThis.fetch.bind(globalThis),
  getSecrets = () => [], lang = (globalThis.navigator && navigator.language) || '', now = () => Date.now(), uuid = newUuid
} = {}) {
  const url = normalizeBackendUrl(backendUrl);
  const api = {
    url,
    /** сервер настроен (уведомление и переключатели в UI показываются только в этом случае) */
    get available() { return !!url; },
    /** 'yes' | 'no' | '' (ещё не выбирали) */
    get consent() { const v = store.get('consent', ''); return v === 'yes' || v === 'no' ? v : ''; },
    get enabled() { return !!url && api.consent === 'yes'; },
    get needsAsk() { return !!url && api.consent === ''; },
    setConsent(v) { store.set('consent', v ? 'yes' : 'no'); store.set('consentTs', now()); },
    get sessionId() {
      let s = store.get('sid', '');
      if (typeof s !== 'string' || !/^[0-9a-f-]{36}$/.test(s)) { s = uuid(); store.set('sid', s); }
      return s;
    },
    rotateSession() { const s = uuid(); store.set('sid', s); return s; },

    /** Отправляет событие «вопрос + ответ». Возвращает Promise<boolean>, никогда не бросает. */
    async logExchange({ chatId, provider, model, slot = 'A', userText = '', assistantText = '', ts = now(), eventId = '' }) {
      try {
        if (!api.enabled || !fetchFn) return false;
        const secrets = getSecrets();
        const u = redact(userText, secrets), a = redact(assistantText, secrets);
        if (!u.trim() && !a.trim()) return false;
        const body = { session_id: api.sessionId, chat_id: String(chatId || 'chat').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'chat',
          provider: provider ? String(provider).slice(0, 60) : null, model: model ? String(model).slice(0, 100) : null, slot: slot === 'B' ? 'B' : 'A',
          user_text: u.trim() ? u : null, assistant_text: a.trim() ? a : null, ts, lang: String(lang || '').slice(0, 20) || null };
        const eid = String(eventId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64); if (eid) body.event_id = eid;
        const json = JSON.stringify(body);
        const keepalive = new Blob([json]).size < KEEPALIVE_LIMIT;
        // text/plain = «простой» CORS-запрос без preflight; бэкенд разбирает JSON независимо от Content-Type
        const r = await fetchFn(url + '/api/log', { method: 'POST', body: json, headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          keepalive, mode: 'cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
        return !!(r && r.ok);
      } catch { return false; }
    },

    /** Удаляет с сервера всё, что сохранено под текущим session_id, затем выдаёт новый session_id. */
    async deleteMyData() {
      if (!url) return { ok: false, error: 'Сервер не настроен' };
      try {
        const sid = api.sessionId;
        const r = await fetchFn(url + '/api/session/' + encodeURIComponent(sid), { method: 'DELETE', mode: 'cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
        if (!r.ok) return { ok: false, error: 'Сервер ответил ' + r.status };
        let deleted = 0; try { deleted = (await r.json()).deleted || 0; } catch { /* */ }
        api.rotateSession();
        return { ok: true, deleted };
      } catch { return { ok: false, error: 'Не удалось связаться с сервером' }; }
    }
  };
  return api;
}
