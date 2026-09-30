/* Единая точка генерации: облачные провайдеры (api.js) и модель в браузере (local.js). */
import { chat, HttpError } from './api.js';
import { generateLocal } from './local.js';
import { estimateTokens } from './util.js';
import { limiterFor } from './limiter.js';

const stripThink = s => String(s || '').replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();

/** Собирает сообщения для API: без ошибок/пустых, без размышлений; обрезает старые под бюджет контекста. */
export function prepareMessages(history, budgetTokens = 12000) {
  const all = history.filter(m => !m.error && (m.content || '').trim()).map(m => ({ role: m.role, content: m.role === 'assistant' ? stripThink(m.content) : m.content, images: m.role === 'user' && Array.isArray(m._images) ? m._images : null })).filter(m => m.content);
  // между двумя одинаковыми ролями подряд (после ошибок/удалений) провайдеры иногда капризничают — склеиваем
  const merged = [];
  for (const m of all) { const l = merged[merged.length - 1]; if (l && l.role === m.role) { l.content += '\n\n' + m.content; if (m.images) l.images = (l.images || []).concat(m.images); } else merged.push({ role: m.role, content: m.content, images: m.images }); }
  for (const m of merged) if (!m.images || !m.images.length) delete m.images;
  let total = merged.reduce((n, m) => n + estimateTokens(m.content) + 4 + (m.images ? m.images.length * 400 : 0), 0), trimmed = 0;
  while (merged.length > 1 && total > budgetTokens) { const r = merged.shift(); total -= estimateTokens(r.content) + 4; trimmed++; }
  while (merged.length > 1 && merged[0].role !== 'user') merged.shift();
  return { messages: merged, trimmed, tokens: total };
}

export async function generate(p, opts, cb = {}) {
  if (p.type === 'local') {
    const release = await limiterFor(p).acquire(opts.model, { signal: cb.signal, onWait: (sec, reason) => { if (!reason) cb.onStatus && cb.onStatus({ type: 'clear' }); else cb.onStatus && cb.onStatus({ type: 'wait', text: 'Ждём, пока освободится локальная модель…' }); } });
    try { return await runLocal(p, opts, cb); } finally { release(); }
  }
  return chat(p, opts, cb);
}
async function runLocal(p, opts, cb) {
  let started = false;
  {
    const msgs = (opts.system ? [{ role: 'system', content: opts.system }] : []).concat(opts.messages);
    const r = await generateLocal(opts.model, msgs, {
      maxTokens: opts.maxTokens || 512, temp: opts.temp, signal: cb.signal,
      onDelta: t => { if (!started) { started = true; cb.onStatus && cb.onStatus({ type: 'clear' }); } cb.onDelta && cb.onDelta(t); },
      onProgress: pr => cb.onStatus && cb.onStatus({ type: 'progress', loaded: pr.loaded, total: pr.total })
    });
    cb.onStatus && cb.onStatus({ type: 'clear' });
    if (!r.content.trim()) throw new Error('Модель вернула пустой ответ.');
    return r;
  }
}
export { HttpError };
