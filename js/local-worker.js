/* Web Worker: запуск малой LLM прямо в браузере через transformers.js (грузится с jsDelivr при первом использовании).
 * Протокол: {type:'load',id,model,device} → progress/ready/error ; {type:'generate',id,messages,maxTokens,temp} → token/done/error ; {type:'interrupt'} */
const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0';
let lib = null, gen = null, curModel = '', curDevice = '', stopper = null;
const post = m => self.postMessage(m);

async function pickDevice(want) {
  if (want && want !== 'auto') return want;
  try {
    if (self.navigator && navigator.gpu) { const a = await navigator.gpu.requestAdapter(); if (a && !a.isFallbackAdapter) return 'webgpu'; }
  } catch { /* */ }
  return 'wasm';
}

self.onmessage = async ev => {
  const m = ev.data;
  try {
    if (m.type === 'interrupt') { if (stopper) stopper.interrupt(); return; }
    if (m.type === 'load') {
      if (!lib) lib = await import(LIB);
      const device = await pickDevice(m.device);
      if (gen && curModel === m.model && curDevice === device) return post({ type: 'ready', id: m.id, device });
      gen = null;
      const files = {};
      gen = await lib.pipeline('text-generation', m.model, {
        device, dtype: 'q4',
        progress_callback: p => {
          if (p.status === 'progress' && p.file) { files[p.file] = { loaded: p.loaded || 0, total: p.total || 0 }; }
          if (p.status === 'progress' || p.status === 'initiate' || p.status === 'done') {
            let loaded = 0, total = 0; for (const f of Object.values(files)) { loaded += f.loaded; total += f.total; }
            post({ type: 'progress', id: m.id, loaded, total, file: p.file, status: p.status });
          }
        }
      });
      curModel = m.model; curDevice = device;
      return post({ type: 'ready', id: m.id, device });
    }
    if (m.type === 'generate') {
      if (!gen) throw new Error('Модель не загружена');
      stopper = new lib.InterruptableStoppingCriteria();
      const streamer = new lib.TextStreamer(gen.tokenizer, { skip_prompt: true, skip_special_tokens: true, callback_function: t => post({ type: 'token', id: m.id, text: t }) });
      const temp = typeof m.temp === 'number' ? m.temp : 0.7;
      await gen(m.messages, {
        max_new_tokens: m.maxTokens || 512, do_sample: temp > 0.05, temperature: Math.max(temp, 0.05), top_p: 0.9, repetition_penalty: 1.1,
        streamer, stopping_criteria: stopper
      });
      const interrupted = stopper && stopper.interrupted; stopper = null;
      return post({ type: 'done', id: m.id, interrupted });
    }
  } catch (e) {
    post({ type: 'error', id: m.id, message: (e && e.message) || String(e) });
  }
};
