/* Клиентская часть «модели в браузере». Один общий воркер; сторож (watchdog) не даёт ответу «висеть» бесконечно. */
import { abortError } from './util.js?v=3.11';

let worker = null, seq = 0;
const pending = new Map();
let loadedKey = '';
export const localState = { device: '', loading: false, loaded: '' };
const LOAD_STALL_MS = 120000;   // без единого события загрузки/инициализации
const GEN_STALL_MS = 90000;     // без единого нового токена

function failAll(message) { const hs = [...pending.values()]; pending.clear(); for (const h of hs) h({ type: 'error', message }); }
function killWorker(message) {
  if (worker) { try { worker.terminate(); } catch { /* */ } }
  worker = null; loadedKey = ''; localState.loaded = ''; localState.loading = false;
  if (message) failAll(message);
}
function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./local-worker.js?v=3.11', import.meta.url), { type: 'module' });
  worker.onmessage = e => { const d = e.data || {}; const h = pending.get(d.id); if (h) h(d); else if (d.type === 'error' && !d.id) failAll(d.message); };
  worker.onerror = e => { e.preventDefault && e.preventDefault(); killWorker('WORKER: ' + (e.message || 'не удалось запустить модуль модели')); };
  worker.onmessageerror = () => killWorker('WORKER: ошибка обмена данными с воркером');
  return worker;
}
export function localSupported() { return typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined'; }
export async function webgpuAvailable() {
  try { if (!navigator.gpu) return false; const a = await navigator.gpu.requestAdapter(); return !!a && !a.isFallbackAdapter; } catch { return false; }
}

/** Человекочитаемый текст ошибки для пузыря ответа. */
export function friendlyLocalError(raw) {
  const s = String(raw || '');
  if (/NO_WEBGPU/.test(s)) return 'WebGPU недоступен в этом браузере. Модель может работать через WASM (медленнее) — обновите браузер или выберите модель поменьше.';
  if (/out of memory|OOM|memory access out of bounds|Array buffer allocation|allocation failed|bad_alloc|RangeError.*(buffer|memory)|Aborted\(|maximum memory|device (was )?lost/i.test(s))
    return 'Не хватило памяти устройства для этой модели. Закройте лишние вкладки или выберите модель поменьше (SmolLM2 135M/360M).';
  if (/NET:|Failed to fetch|NetworkError|network|Load failed|ERR_|ECONN|status (4|5)\d\d|Could not locate file|fetch/i.test(s))
    return 'Не удалось скачать модель или библиотеку (сеть/блокировщик). Проверьте подключение и попробуйте ещё раз. ' + (s.length < 200 ? '(' + s.replace(/^NET:\s*/, '') + ')' : '');
  if (/STALL/.test(s)) return s.replace(/^STALL:\s*/, '');
  if (/WORKER:/.test(s)) return 'Модель в браузере аварийно остановилась (' + s.replace(/^WORKER:\s*/, '') + '). Обычно это нехватка памяти — попробуйте модель поменьше.';
  return 'Ошибка модели в браузере: ' + s;
}

function watchdog(ms, onStall) {
  let t = null; const kick = (n = ms) => { clearTimeout(t); t = setTimeout(onStall, n); };
  return { kick, stop: () => clearTimeout(t) };
}

export function loadLocalModel(model, { onProgress, signal, device = 'auto', size = 0 } = {}) {
  if (loadedKey === model && worker) return Promise.resolve(localState.device);
  return new Promise((resolve, reject) => {
    const w = ensureWorker(); const id = ++seq; localState.loading = true;
    const wd = watchdog(LOAD_STALL_MS, () => { pending.delete(id); killWorker(); reject(new Error('STALL: Загрузка модели остановилась (нет данных ' + Math.round(LOAD_STALL_MS / 1000) + ' с). Проверьте сеть и попробуйте снова.')); });
    const end = () => { wd.stop(); pending.delete(id); localState.loading = false; if (signal) signal.removeEventListener('abort', onAbort); };
    const onAbort = () => { end(); reject(abortError()); };
    if (signal) { if (signal.aborted) return onAbort(); signal.addEventListener('abort', onAbort, { once: true }); }
    pending.set(id, m => {
      if (m.type === 'progress') { wd.kick(m.stage === 'init' ? LOAD_STALL_MS * 2 : LOAD_STALL_MS); onProgress && onProgress(m); }
      else if (m.type === 'ready') { end(); localState.device = m.device; localState.loaded = model; loadedKey = model; resolve(m.device); }
      else if (m.type === 'error') { end(); reject(new Error(friendlyLocalError(m.message))); }
    });
    wd.kick();
    w.postMessage({ type: 'load', id, model, device, size });
  });
}

export async function generateLocal(model, messages, { maxTokens, temp, signal, onDelta, onProgress, size } = {}) {
  await loadLocalModel(model, { onProgress, signal, size });
  return new Promise((resolve, reject) => {
    const w = ensureWorker(); const id = ++seq; let full = '';
    const wd = watchdog(GEN_STALL_MS, () => { pending.delete(id); killWorker(); reject(new Error('STALL: Модель перестала отвечать (' + Math.round(GEN_STALL_MS / 1000) + ' с без новых слов) — вероятно, не хватило памяти или устройство слишком медленное. Попробуйте модель поменьше.')); });
    const end = () => { wd.stop(); pending.delete(id); if (signal) signal.removeEventListener('abort', onAbort); };
    const onAbort = () => { w.postMessage({ type: 'interrupt' }); setTimeout(() => { if (pending.has(id)) { end(); reject(abortError()); } }, 3000); };
    if (signal) { if (signal.aborted) return reject(abortError()); signal.addEventListener('abort', onAbort, { once: true }); }
    pending.set(id, m => {
      if (m.type === 'token') { wd.kick(); full += m.text; onDelta && onDelta(m.text); }
      else if (m.type === 'progress') { wd.kick(GEN_STALL_MS * 2); onProgress && onProgress(m); }
      else if (m.type === 'done') { end(); if (m.interrupted && signal && signal.aborted) reject(abortError()); else resolve({ content: full, reasoning: '', usage: null, finish: 'stop' }); }
      else if (m.type === 'error') { end(); reject(new Error(friendlyLocalError(m.message))); }
    });
    wd.kick(GEN_STALL_MS * 2);   // первый токен ждём дольше (prefill на CPU)
    w.postMessage({ type: 'generate', id, messages, maxTokens, temp });
  });
}
