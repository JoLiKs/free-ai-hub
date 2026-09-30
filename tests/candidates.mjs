#!/usr/bin/env node
/* Проверка КАНДИДАТОВ в новые бесключевые источники: годится ли эндпоинт для вызова из браузера
 * (CORS-preflight с чужого Origin) и отдаёт ли он реальный ответ без ключа.
 *   node tests/candidates.mjs [--origin https://your.site]
 * Ничего не «обходит»: никаких ключей, только публично заявленный анонимный доступ. Один крошечный запрос на кандидата. */
const origin = (() => { const i = process.argv.indexOf('--origin'); return i > 0 ? process.argv[i + 1] : 'https://example-origin.zerodeploy.app'; })();

const C = [
  { name: 'Kilo Gateway (kilo-auto/free)', url: 'https://api.kilo.ai/api/gateway/chat/completions', model: 'kilo-auto/free' },
  { name: 'VLM Run Gateway (qwen3.8-27b)', url: 'https://gateway.vlm.run/v1/openai/chat/completions', model: 'qwen/qwen3.8-27b' },
  { name: 'LLM Tech (trial key на сайте, не используется)', url: 'https://api.llmtech.eu/v1/chat/completions', model: 'nvidia/Qwen3.8-27B-NVFP4', noKey: false },
  { name: 'uncloseai Hermes (публичный, 3 зап./с)', url: 'https://hermes.ai.unturf.com/v1/chat/completions', model: 'auto', modelsUrl: 'https://hermes.ai.unturf.com/v1/models' },
  { name: 'OpenCode Zen (big-pickle)', url: 'https://opencode.ai/zen/v1/chat/completions', model: 'big-pickle' },
  { name: 'api.airforce', url: 'https://api.airforce/v1/chat/completions', model: 'gpt-4o-mini' },
  { name: 'g4f.space', url: 'https://g4f.space/v1/chat/completions', model: 'gpt-4o-mini' },
  { name: 'Hack Club AI', url: 'https://ai.hackclub.com/chat/completions', model: 'qwen/qwen3-32b' },
  { name: 'Pollinations gen (новый API)', url: 'https://gen.pollinations.ai/v1/chat/completions', model: 'openai' },
  { name: 'BlockRun free (nemotron-3.5-lightning)', url: 'https://blockrun.ai/api/v1/chat/completions', model: 'nvidia/nemotron-3.5-lightning' },
  { name: 'InferencePort / sharktide-lightning (gpt-oss-20b; не используется: анонимный доступ не заявлен)', url: 'https://sharktide-lightning.hf.space/gen/chat/completions', model: 'gpt-oss-20b', skipChat: true },
  { name: 'PersorAI', url: 'https://persorai.com/v1/chat/completions', model: '@cf/zai-org/glm-5.2' },
  { name: 'JankRouter (без ключа только модерационная модель)', url: 'https://jankrouter.waifly.com/v1/chat/completions', model: 'gemma-4-26b-a4b' },
  // для контроля — известные рабочие
  { name: '[контроль] ch.at', url: 'https://ch.at/v1/chat/completions', model: 'gpt-4o' },
  { name: '[контроль] OVHcloud', url: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions', model: 'gpt-oss-20b' },
  { name: '[контроль] LLM7', url: 'https://api.llm7.io/v1/chat/completions', model: 'codestral-latest' }
];

async function t(url, init, ms = 25000) {
  const ac = new AbortController(); const to = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, Object.assign({ signal: ac.signal }, init)); } finally { clearTimeout(to); }
}
console.log(`Проверка кандидатов · ${new Date().toISOString()} · Origin ${origin}\n`);
for (const c of C) {
  let cors = '?', chat = '?';
  try {
    const r = await t(c.url, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization' } }, 15000);
    const ao = r.headers.get('access-control-allow-origin');
    cors = (r.status < 300 && (ao === '*' || ao === origin)) ? 'CORS ok' : `нет CORS (HTTP ${r.status}${ao ? ', ao=' + ao : ''})`;
  } catch (e) { cors = 'preflight: ' + (e.name === 'AbortError' ? 'таймаут' : e.cause?.code || e.message); }
  if (c.skipChat) { console.log(`⏭  ${c.name}\n     ${cors} · чат не вызывался`); continue; }
  try {
    let model = c.model;
    if (c.modelsUrl) { try { const m = await (await t(c.modelsUrl, { headers: { Origin: origin } }, 10000)).json(); model = m.data[0].id; } catch { /* оставим */ } }
    const r = await t(c.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Say ok' }], max_tokens: 12 }) });
    const txt = await r.text(); let ans = '';
    try { const j = JSON.parse(txt); ans = j.choices?.[0]?.message?.content || ''; } catch { /* */ }
    chat = r.ok && ans ? `ответ ✓ («${ans.slice(0, 30).replace(/\s+/g, ' ')}»)` : `HTTP ${r.status} ${txt.slice(0, 70).replace(/\s+/g, ' ')}`;
  } catch (e) { chat = 'запрос: ' + (e.name === 'AbortError' ? 'таймаут' : e.cause?.code || e.message); }
  const usable = /ok/.test(cors) && /✓/.test(chat);
  console.log(`${usable ? '✅' : '❌'} ${c.name}\n     ${cors} · ${chat}`);
}
