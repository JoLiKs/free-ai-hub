/* Клиентская очередь запросов на провайдера: одновременность, минимальная пауза,
 * скользящее окно «N запросов за T мс» (на модель или на провайдера) и «штраф» после 429.
 * Вызывающий получает уведомления об ожидании (для видимого обратного отсчёта). */
import { abortError } from './util.js';

export class QueueWaitError extends Error { constructor(ms) { super('queue wait ' + ms); this.name = 'QueueWaitError'; this.waitMs = ms; } }

export class Limiter {
  constructor(limits = {}, now = () => Date.now()) {
    this.conc = limits.concurrency || 2;
    this.gap = limits.minGapMs || 0;
    this.rate = limits.rate || null;
    this.now = now;
    this.active = 0; this.q = []; this.lastStart = 0;
    this.starts = new Map();       // key -> [timestamps]
    this.blocked = new Map();      // key -> until
    this.timer = null;
  }
  scopeKey(model) { return this.rate && this.rate.per === 'model' ? model : '*'; }

  /** Запрещает новые старты по ключу на ms (после 429/402). model=null → весь провайдер. */
  penalize(model, ms) {
    const key = model ? this.scopeKey(model) : '*';
    const until = this.now() + ms;
    if ((this.blocked.get(key) || 0) < until) this.blocked.set(key, until);
    this.pump();
  }

  /** Сколько мс ждать этому запросу; Infinity — ждём освобождения слота. reason — причина. */
  delayFor(w) {
    const t = this.now();
    let d = 0, reason = '';
    const pen = Math.max(this.blocked.get(this.scopeKey(w.model)) || 0, this.blocked.get('*') || 0) - t;
    if (pen > 0) { d = pen; reason = 'penalty'; }
    if (this.gap) { const g = this.lastStart + this.gap - t; if (g > d) { d = g; reason = 'gap'; } }
    if (this.rate) {
      const key = this.scopeKey(w.model);
      const arr = (this.starts.get(key) || []).filter(x => x > t - this.rate.perMs);
      this.starts.set(key, arr);
      if (arr.length >= this.rate.max) { const r = arr[arr.length - this.rate.max] + this.rate.perMs - t; if (r > d) { d = r; reason = 'rate'; } }
    }
    if (this.active >= this.conc) return { ms: d > 0 ? Math.max(d, 250) : Infinity, reason: d > 0 ? reason : 'busy' };
    return { ms: d, reason };
  }

  acquire(model, { signal, onWait, maxWaitMs } = {}) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) return reject(abortError());
      const w = { model, resolve, reject, onWait, signal, tick: null, maxWaitMs };
      w.onAbort = () => { this._drop(w); reject(abortError()); };
      if (signal) signal.addEventListener('abort', w.onAbort, { once: true });
      this.q.push(w); this.pump();
    });
  }
  _drop(w) {
    const i = this.q.indexOf(w); if (i >= 0) this.q.splice(i, 1);
    if (w.tick) { clearInterval(w.tick); w.tick = null; }
    if (w.signal) w.signal.removeEventListener('abort', w.onAbort);
    if (w.onWait && w.notified) w.onWait(0, '');
  }
  pump() {
    clearTimeout(this.timer); this.timer = null;
    let next = Infinity;
    for (const w of this.q.slice()) {
      if (!this.q.includes(w)) continue;
      const { ms, reason } = this.delayFor(w);
      if (ms <= 0) { this._start(w); continue; }
      if (w.maxWaitMs != null && ms !== Infinity && ms > w.maxWaitMs) { this._drop(w); w.reject(new QueueWaitError(ms)); continue; }
      if (ms !== Infinity) next = Math.min(next, ms);
      this._notify(w, ms, reason);
    }
    if (next !== Infinity && this.q.length) this.timer = setTimeout(() => this.pump(), Math.min(next, 1000) + 5);
    else if (this.q.length && this.active === 0 && next === Infinity) this.timer = setTimeout(() => this.pump(), 500);
  }
  _notify(w, ms, reason) {
    if (!w.onWait) return;
    w.notified = true;
    w.onWait(ms === Infinity ? null : Math.ceil(ms / 1000), reason);
  }
  _start(w) {
    this._drop(w);
    this.active++; const t = this.now(); this.lastStart = t;
    const key = this.scopeKey(w.model);
    const arr = this.starts.get(key) || []; arr.push(t); this.starts.set(key, arr);
    let released = false;
    w.resolve(() => { if (released) return; released = true; this.active--; this.pump(); });
  }
}

const limiters = new Map();
export function limiterFor(provider) {
  let l = limiters.get(provider.id);
  if (!l) { l = new Limiter(provider.limits || {}); limiters.set(provider.id, l); }
  return l;
}
export function resetLimiters() { limiters.clear(); }
