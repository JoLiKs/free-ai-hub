/* Общие утилиты: без зависимостей, без DOM-обращений на верхнем уровне (годится и для node-тестов). */

export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Пауза с возможностью отмены через AbortSignal. Отклоняется AbortError. */
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(abortError());
    const t = setTimeout(() => { if (signal) signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(abortError()); };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}
export function abortError() { const e = new Error('Aborted'); e.name = 'AbortError'; return e; }

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  d.cancel = () => clearTimeout(t);
  return d;
}

/** Грубая оценка числа токенов: латиница ≈ 4 симв./токен, кириллица и прочее ≈ 2 симв./токен. */
export function estimateTokens(text) {
  if (!text) return 0;
  let latin = 0, other = 0;
  for (let i = 0; i < text.length; i++) (text.charCodeAt(i) < 0x250 ? latin++ : other++);
  return Math.ceil(latin / 4 + other / 2);
}

/** Обёртка над localStorage с префиксом и JSON; не падает в приватном режиме / при переполнении. */
export function makeStore(storage, prefix = 'fah.') {
  return {
    get(k, d) { try { const v = storage.getItem(prefix + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { storage.setItem(prefix + k, JSON.stringify(v)); return true; } catch { return false; } },
    del(k) { try { storage.removeItem(prefix + k); } catch { /* */ } },
    keys() { const out = []; try { for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k && k.startsWith(prefix)) out.push(k.slice(prefix.length)); } } catch { /* */ } return out; }
  };
}

export function fmtAgo(ts, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return 'только что';
  const m = Math.round(s / 60); if (m < 60) return m + ' мин назад';
  const h = Math.round(m / 60); if (h < 24) return h + ' ч назад';
  return Math.round(h / 24) + ' дн назад';
}
export function fmtTime(ts) { const d = new Date(ts); return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); }
export function fmtBytes(n) { if (n >= 1e9) return (n / 1e9).toFixed(1) + ' ГБ'; if (n >= 1e6) return Math.round(n / 1e6) + ' МБ'; return Math.round(n / 1e3) + ' КБ'; }

export function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40) || 'chat'; }
