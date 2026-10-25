/* Web Worker: запуск малой LLM прямо в браузере через transformers.js (грузится с jsDelivr при первом использовании).
 * Протокол: {type:'load',id,model,device,size} → progress/ready/error ; {type:'generate',id,messages,maxTokens,temp} → token/done/error ; {type:'interrupt'}
 * progress: {stage:'lib'|'download'|'init', loaded, total, file} — общий прогресс по всем файлам модели. */
const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1';
let lib = null, gen = null, curModel = '', curDevice = '', stopper = null, activeId = 0;
const post = m => self.postMessage(m);

// любая «потерянная» ошибка внутри воркера (ORT, wasm abort) → сообщение активному запросу, а не вечное ожидание
self.addEventListener('unhandledrejection', e => { post({ type: 'error', id: activeId, message: errText(e.reason) }); });
self.addEventListener('error', e => { post({ type: 'error', id: activeId, message: errText(e.error || e.message) }); });
function errText(e) { return (e && (e.message || (typeof e === 'string' ? e : ''))) || String(e || 'неизвестная ошибка'); }

async function hasWebGPU() {
  try { if (self.navigator && navigator.gpu) { const a = await navigator.gpu.requestAdapter(); return !!(a && !a.isFallbackAdapter); } } catch { /* */ }
  return false;
}
async function pickDevice(want) {
  if (want === 'webgpu' && !(await hasWebGPU())) throw new Error('NO_WEBGPU: WebGPU недоступен в этом браузере');
  if (want && want !== 'auto') return want;
  return (await hasWebGPU()) ? 'webgpu' : 'wasm';
}

async function loadPipeline(m, device) {
  const files = {}; let lastPost = 0, total = 0;
  const send = (stage, force) => {
    const now = Date.now(); if (!force && now - lastPost < 150) return; lastPost = now;
    let loaded = 0, sum = 0; for (const f of Object.values(files)) { loaded += f.loaded; sum += f.total; }
    total = Math.max(sum, m.size || 0, loaded);
    post({ type: 'progress', id: m.id, stage, loaded, total, device });
  };
  return lib.pipeline('text-generation', m.model, {
    device, dtype: device === 'webgpu' ? 'q4f16' : 'q4',
    progress_callback: p => {
      if (!p || !p.file) return;
      if (p.status === 'initiate' || p.status === 'download') { files[p.file] = files[p.file] || { loaded: 0, total: 0 }; send('download'); }
      else if (p.status === 'progress') { files[p.file] = { loaded: p.loaded || 0, total: p.total || (files[p.file] && files[p.file].total) || 0 }; send('download'); }
      else if (p.status === 'done') { const f = files[p.file] || (files[p.file] = { loaded: 0, total: 0 }); f.total = f.total || f.loaded; f.loaded = f.total; send('download', true); if (/\.onnx(_data)?$/.test(p.file) || p.file.includes('onnx/')) send('init', true); }
    }
  });
}

self.onmessage = async ev => {
  const m = ev.data;
  try {
    if (m.type === 'interrupt') { if (stopper) stopper.interrupt(); return; }
    activeId = m.id;
    if (m.type === 'load') {
      if (!lib) {
        post({ type: 'progress', id: m.id, stage: 'lib', loaded: 0, total: 0 });
        try { lib = await import(LIB); } catch (e) { throw new Error('NET: не удалось загрузить библиотеку transformers.js с jsDelivr (' + errText(e) + ')'); }
      }
      let device = await pickDevice(m.device);
      if (gen && curModel === m.model && curDevice === device) return post({ type: 'ready', id: m.id, device });
      if (gen && gen.dispose) { try { await gen.dispose(); } catch { /* */ } }
      gen = null; curModel = '';
      try { gen = await loadPipeline(m, device); }
      catch (e) {
        if (device !== 'webgpu') throw e;
        // WebGPU есть, но модель на нём не поднялась (драйвер/память/неподдерживаемый оператор) — пробуем WASM
        post({ type: 'progress', id: m.id, stage: 'fallback', loaded: 0, total: 0, note: errText(e) });
        device = 'wasm'; gen = await loadPipeline(m, device);
      }
      curModel = m.model; curDevice = device;
      return post({ type: 'ready', id: m.id, device });
    }
    if (m.type === 'generate') {
      if (!gen) throw new Error('Модель не загружена');
      stopper = new lib.InterruptableStoppingCriteria();
      // малые модели иногда «залипают»: бесконечные пробелы/переводы строк или один и тот же кусок — обрываем такой хвост
      let blank = 0, same = 0, prev = '', autoStop = false;
      const streamer = new lib.TextStreamer(gen.tokenizer, { skip_prompt: true, skip_special_tokens: true, callback_function: t => {
        if (!t) return;
        blank = t.trim() ? 0 : blank + 1; same = t === prev && t.trim() ? same + 1 : 0; prev = t;
        if ((blank >= 12 || same >= 24) && stopper && !autoStop) { autoStop = true; stopper.interrupt(); }
        post({ type: 'token', id: m.id, text: t });
      } });
      const temp = typeof m.temp === 'number' ? m.temp : 0.7;
      post({ type: 'progress', id: m.id, stage: 'prefill', loaded: 0, total: 0, device: curDevice });
      await gen(m.messages, {
        max_new_tokens: m.maxTokens || 512, do_sample: temp > 0.05, temperature: Math.max(temp, 0.05), top_p: 0.9, repetition_penalty: 1.1,
        streamer, stopping_criteria: stopper
      });
      const interrupted = stopper && stopper.interrupted && !autoStop; stopper = null;
      return post({ type: 'done', id: m.id, interrupted });
    }
  } catch (e) {
    stopper = null;
    post({ type: 'error', id: m.id, message: errText(e) });
  }
};
