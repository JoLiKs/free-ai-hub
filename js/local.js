/* Клиентская часть «модели в браузере». Один общий воркер. */
import { abortError } from './util.js';

let worker = null, seq = 0;
const pending = new Map();
let loadedKey = '';
export const localState = { device: '', loading: false, loaded: '' };

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./local-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = e => { const h = pending.get(e.data.id); if (h) h(e.data); };
  worker.onerror = e => { for (const h of pending.values()) h({ type: 'error', message: 'Ошибка воркера: ' + (e.message || 'не удалось загрузить модуль') }); };
  return worker;
}
export function localSupported() { return typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined'; }
export async function webgpuAvailable() {
  try { if (!navigator.gpu) return false; const a = await navigator.gpu.requestAdapter(); return !!a && !a.isFallbackAdapter; } catch { return false; }
}

export function loadLocalModel(model, { onProgress, signal, device = 'auto' } = {}) {
  if (loadedKey === model) return Promise.resolve(localState.device);
  return new Promise((resolve, reject) => {
    const w = ensureWorker(); const id = ++seq; localState.loading = true;
    const onAbort = () => { pending.delete(id); localState.loading = false; reject(abortError()); };
    if (signal) { if (signal.aborted) return onAbort(); signal.addEventListener('abort', onAbort, { once: true }); }
    pending.set(id, m => {
      if (m.type === 'progress') onProgress && onProgress(m);
      else if (m.type === 'ready') { pending.delete(id); localState.loading = false; localState.device = m.device; localState.loaded = model; loadedKey = model; resolve(m.device); }
      else if (m.type === 'error') { pending.delete(id); localState.loading = false; reject(new Error(m.message)); }
    });
    w.postMessage({ type: 'load', id, model, device });
  });
}

export async function generateLocal(model, messages, { maxTokens, temp, signal, onDelta, onProgress } = {}) {
  await loadLocalModel(model, { onProgress, signal });
  return new Promise((resolve, reject) => {
    const w = ensureWorker(); const id = ++seq; let full = '';
    const onAbort = () => { w.postMessage({ type: 'interrupt' }); };
    if (signal) { if (signal.aborted) return reject(abortError()); signal.addEventListener('abort', onAbort, { once: true }); }
    pending.set(id, m => {
      if (m.type === 'token') { full += m.text; onDelta && onDelta(m.text); }
      else if (m.type === 'done') { pending.delete(id); if (signal) signal.removeEventListener('abort', onAbort); if (m.interrupted && signal && signal.aborted) reject(abortError()); else resolve({ content: full, reasoning: '', usage: null, finish: 'stop' }); }
      else if (m.type === 'error') { pending.delete(id); if (signal) signal.removeEventListener('abort', onAbort); reject(new Error(m.message)); }
    });
    w.postMessage({ type: 'generate', id, messages, maxTokens, temp });
  });
}
