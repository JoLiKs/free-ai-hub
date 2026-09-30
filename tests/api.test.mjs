import assert from 'node:assert/strict';
import { readSSE, extractOpenAI, extractGemini, requestOnce, retryDelay, HttpError, explainError, buildRequest, StreamError, TimeoutError } from '../js/api.js';
import { Limiter } from '../js/limiter.js';
import { ChatStore, newChat, exportMarkdown } from '../js/chats.js';
import { makeMemoryStore } from '../js/store.js';
import { prepareMessages } from '../js/generate.js';
import { getModels, classify } from '../js/models.js';
import { pById } from '../js/providers.js';

let n = 0; const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const enc = new TextEncoder();
const streamOf = (chunks) => new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(typeof ch === 'string' ? enc.encode(ch) : ch); c.close(); } });
const collect = async (chunks, opts) => { const out = []; await readSSE(streamOf(chunks), (d, ev) => out.push(ev ? [ev, d] : d), opts); return out; };
const sseRes = (chunks, status = 200, headers = {}) => new Response(streamOf(chunks), { status, headers: Object.assign({ 'content-type': 'text/event-stream' }, headers) });
const delta = (c, extra = {}) => 'data: ' + JSON.stringify({ choices: [{ delta: Object.assign({ content: c }, extra) }] }) + '\n\n';

t('SSE: простой поток + [DONE]', async () => assert.deepEqual(await collect(['data: {"a":1}\n\ndata: {"a":2}\n\ndata: [DONE]\n\n']), ['{"a":1}', '{"a":2}']));
t('SSE: событие разрезано посреди JSON', async () => assert.deepEqual(await collect(['data: {"a":', '1}\n', '\ndata: {"b":2}\n\n']), ['{"a":1}', '{"b":2}']));
t('SSE: разрез по одному байту', async () => { const s = 'data: {"t":"привет"}\n\ndata: [DONE]\n\n'; const b = enc.encode(s); assert.deepEqual(await collect([...b].map(x => new Uint8Array([x]))), ['{"t":"привет"}']); });
t('SSE: CRLF и разрез \\r|\\n', async () => assert.deepEqual(await collect(['data: {"a":1}\r', '\n\r\ndata: {"a":2}\r\n\r\n']), ['{"a":1}', '{"a":2}']));
t('SSE: комментарии/keep-alive игнорируются', async () => assert.deepEqual(await collect([': ping\n\ndata: {"a":1}\n\n: ping\n\n']), ['{"a":1}']));
t('SSE: без пустой строки между событиями (как у ch.at)', async () => assert.deepEqual(await collect(['data: {"a":1}\ndata: {"a":2}\ndata: [DONE]\n']), ['{"a":1}', '{"a":2}']));
t('SSE: последнее событие без завершающей пустой строки', async () => assert.deepEqual(await collect(['data: {"a":1}']), ['{"a":1}']));
t('SSE: event:error', async () => assert.deepEqual(await collect(['event: error\ndata: {"error":"x"}\n\n']), [['error', '{"error":"x"}']]));
t('SSE: "data:" без пробела', async () => assert.deepEqual(await collect(['data:{"a":1}\n\n']), ['{"a":1}']));
t('SSE: [DONE] прекращает чтение', async () => assert.deepEqual(await collect(['data: [DONE]\n\ndata: {"late":1}\n\n']), []));

t('extractOpenAI: content / reasoning_content / reasoning / массив', () => {
  assert.deepEqual(extractOpenAI({ choices: [{ delta: { content: 'a' } }] }).text, 'a');
  assert.equal(extractOpenAI({ choices: [{ delta: { reasoning_content: 'r' } }] }).reasoning, 'r');
  assert.equal(extractOpenAI({ choices: [{ delta: { reasoning: 'r2', content: null } }] }).reasoning, 'r2');
  assert.equal(extractOpenAI({ choices: [{ delta: { content: [{ type: 'text', text: 'x' }, { text: 'y' }] } }] }).text, 'xy');
  assert.equal(extractOpenAI({ choices: [{ message: { content: 'full' } }] }).text, 'full');
  assert.equal(extractOpenAI({ choices: [] }).text, '');
  assert.throws(() => extractOpenAI({ error: { message: 'boom' } }), /boom/);
  assert.equal(extractOpenAI({ choices: [{ delta: {}, finish_reason: 'length' }] }).finish, 'length');
});
t('extractGemini: thought отделяется', () => { const r = extractGemini({ candidates: [{ content: { parts: [{ text: 'th', thought: true }, { text: 'ans' }] } }] }); assert.equal(r.text, 'ans'); assert.equal(r.reasoning, 'th'); });

t('requestOnce: потоковый ответ с reasoning', async () => {
  const fetchImpl = async () => sseRes([delta('', { reasoning_content: 'думаю' }), delta('При'), delta('вет'), 'data: [DONE]\n\n']);
  let txt = '', rs = '';
  const r = await requestOnce(pById('chat'), { model: 'm', messages: [{ role: 'user', content: 'x' }] }, { fetchImpl, onDelta: d => { txt += d; }, onReasoning: d => { rs += d; } });
  assert.equal(r.content, 'Привет'); assert.equal(txt, 'Привет'); assert.equal(rs, 'думаю'); assert.equal(r.reasoning, 'думаю');
});
t('requestOnce: не-SSE JSON', async () => { const fetchImpl = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'ok!' } }] }), { headers: { 'content-type': 'application/json' } }); const r = await requestOnce(pById('chat'), { model: 'm', messages: [] }, { fetchImpl }); assert.equal(r.content, 'ok!'); });
t('requestOnce: только размышления → понятная ошибка', async () => { const fetchImpl = async () => sseRes([delta('', { reasoning: 'x' }), 'data: [DONE]\n\n']); await assert.rejects(requestOnce(pById('chat'), { model: 'm', messages: [] }, { fetchImpl }), /размышлени/); });
t('requestOnce: пустой ответ', async () => { const fetchImpl = async () => sseRes(['data: [DONE]\n\n']); await assert.rejects(requestOnce(pById('chat'), { model: 'm', messages: [] }, { fetchImpl }), /пустой/); });
t('requestOnce: HTTP 429 → HttpError с retry-after', async () => { const fetchImpl = async () => new Response('{"message":"API rate limit exceeded"}', { status: 429, headers: { 'retry-after': '29', 'content-type': 'application/json' } }); try { await requestOnce(pById('ovh'), { model: 'm', messages: [] }, { fetchImpl }); assert.fail(); } catch (e) { assert.ok(e instanceof HttpError); assert.equal(e.status, 429); assert.equal(e.retryAfter, 29); assert.match(e.message, /rate limit/); assert.match(explainError(e, pById('ovh')), /429/); } });
t('requestOnce: {"error":...} внутри потока', async () => { const fetchImpl = async () => sseRes(['data: {"error":{"message":"upstream died"}}\n\n']); await assert.rejects(requestOnce(pById('chat'), { model: 'm', messages: [] }, { fetchImpl }), /upstream died/); });
t('requestOnce: таймаут заголовков', async () => { const fetchImpl = (u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' })))); await assert.rejects(requestOnce(pById('chat'), { model: 'm', messages: [] }, { fetchImpl, headerTimeoutMs: 60 }), e => e instanceof TimeoutError); });
t('requestOnce: внешний abort → AbortError', async () => { const ac = new AbortController(); const fetchImpl = (u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' })))); const pr = requestOnce(pById('chat'), { model: 'm', messages: [] }, { fetchImpl, signal: ac.signal }); setTimeout(() => ac.abort(), 20); await assert.rejects(pr, e => e.name === 'AbortError'); });
t('requestOnce: idle-таймаут в середине потока', async () => {
  const fetchImpl = async (u, init) => new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode(delta('a'))); init.signal.addEventListener('abort', () => c.error(Object.assign(new Error('a'), { name: 'AbortError' }))); } }), { headers: { 'content-type': 'text/event-stream' } });
  await assert.rejects(requestOnce(pById('chat'), { model: 'm', messages: [] }, { fetchImpl, idleTimeoutMs: 80 }), e => e instanceof TimeoutError);
});

t('retryDelay: 429 с retry-after, OVH без него, 402 Pollinations, 503, 400', () => {
  assert.equal(retryDelay(new HttpError(429, '', 29), 0, pById('ovh')), 30);
  assert.ok(retryDelay(new HttpError(429, ''), 0, pById('ovh')) > 30);
  assert.ok(retryDelay(new HttpError(402, ''), 0, pById('pollinations')) >= 16);
  assert.equal(retryDelay(new HttpError(402, ''), 0, pById('llm7')), null);
  assert.ok(retryDelay(new HttpError(503, ''), 0, pById('llm7')) <= 6);
  assert.equal(retryDelay(new HttpError(400, ''), 0, pById('llm7')), null);
  assert.equal(retryDelay(new HttpError(429, '', 500), 0, pById('llm7')), null);
});
t('buildRequest: OpenAI / Gemini / anonKey Horde / max_tokens', () => {
  const r = buildRequest(pById('horde'), { model: 'm', messages: [{ role: 'user', content: 'hi' }], system: 'sys', temp: 0.5, maxTokens: 100, stream: true });
  assert.equal(r.init.headers.Authorization, 'Bearer 0000000000'); const b = JSON.parse(r.init.body); assert.equal(b.max_tokens, 100); assert.equal(b.messages[0].role, 'system');
  const g = buildRequest(pById('gemini'), { model: 'gemini-2.5-flash', messages: [{ role: 'assistant', content: 'a' }], key: 'K', temp: 1 }); assert.match(g.url, /streamGenerateContent\?alt=sse/); assert.equal(g.init.headers['x-goog-api-key'], 'K');
  const o = buildRequest(pById('ovh'), { model: 'm', messages: [] }); assert.ok(!('max_tokens' in JSON.parse(o.init.body))); assert.equal(o.init.headers.Authorization, undefined);
});

t('Limiter: rate 2/мин на модель', async () => {
  let now = 0; const lim = new Limiter({ concurrency: 5, rate: { max: 2, perMs: 60000, per: 'model' } }, () => now);
  const r1 = await lim.acquire('a'); const r2 = await lim.acquire('a'); r1(); r2();
  assert.ok(lim.delayFor({ model: 'a' }).ms > 0); assert.equal(lim.delayFor({ model: 'b' }).ms, 0);
  now = 61000; assert.equal(lim.delayFor({ model: 'a' }).ms, 0);
});
t('Limiter: penalize после 429 и concurrency', async () => {
  let now = 1000; const lim = new Limiter({ concurrency: 1 }, () => now);
  const r = await lim.acquire('a'); let second = false; const p2 = lim.acquire('a').then(x => { second = true; return x; });
  await new Promise(r => setTimeout(r, 20)); assert.equal(second, false); r(); const rel2 = await p2; assert.equal(second, true); rel2();
  lim.penalize('a', 5000); assert.ok(lim.delayFor({ model: 'a' }).ms >= 4900);
});
t('Limiter: maxWaitMs → QueueWaitError, abort вынимает из очереди', async () => {
  let now = 0; const lim = new Limiter({ concurrency: 1, rate: { max: 1, perMs: 60000, per: 'model' } }, () => now);
  (await lim.acquire('a'))();
  await assert.rejects(lim.acquire('a', { maxWaitMs: 1000 }), e => e.name === 'QueueWaitError');
  const ac = new AbortController(); const pr = lim.acquire('a', { signal: ac.signal }); ac.abort(); await assert.rejects(pr, e => e.name === 'AbortError'); assert.equal(lim.q.length, 0);
});

t('ChatStore: сохранение, индекс, переименование, закрепление, удаление, экспорт/импорт', () => {
  const cs = new ChatStore(makeMemoryStore()); const c = newChat({ title: 'Привет', msgs: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b', label: 'X' }] });
  cs.save(c); assert.equal(cs.index().length, 1); assert.equal(cs.get(c.id).msgs.length, 2);
  cs.rename(c.id, 'Новое'); assert.equal(cs.get(c.id).title, 'Новое'); assert.equal(cs.togglePin(c.id), true);
  const js = cs.exportJSON(); const cs2 = new ChatStore(makeMemoryStore()); assert.equal(cs2.importJSON(js), 1); assert.equal(cs2.index()[0].title, 'Новое');
  assert.match(exportMarkdown(cs.get(c.id)), /### 🧑 Вы\n\na/); cs.remove(c.id); assert.equal(cs.index().length, 0);
  assert.throws(() => cs2.importJSON('{oops'), /JSON/); assert.throws(() => cs2.importJSON('{"a":1}'), /списка/);
});
t('ChatStore: переполнение хранилища → prune старых', () => {
  const mem = makeMemoryStore(); const cs = new ChatStore(mem); let limit = 3;
  const real = mem.set.bind(mem); let fail = false; mem.set = (k, v) => (fail && k.startsWith('chat.') && !cs._pruned ? false : real(k, v));
  for (let i = 0; i < 5; i++) cs.save(newChat({ title: 'c' + i, msgs: [{ role: 'user', content: 'x' }] }));
  fail = true; const n = newChat({ title: 'new', msgs: [{ role: 'user', content: 'x' }] }); const origPrune = cs.prune.bind(cs); cs.prune = k => { cs._pruned = true; return origPrune(k); };
  cs.save(n); assert.ok(cs.index().length <= 5);
});
t('prepareMessages: убирает ошибки/пустые/думалки, склеивает подряд, режет по бюджету', () => {
  const h = [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'err', error: true }, { role: 'user', content: 'b' }, { role: 'assistant', content: '<think>x</think>ответ' }, { role: 'user', content: 'c' }];
  const r = prepareMessages(h); assert.deepEqual(r.messages.map(m => m.role), ['user', 'assistant', 'user']); assert.equal(r.messages[0].content, 'a\n\nb'); assert.equal(r.messages[1].content, 'ответ');
  const big = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'слово '.repeat(200) })); big.push({ role: 'user', content: 'финал' });
  const r2 = prepareMessages(big.slice(0, 21), 1500); assert.ok(r2.trimmed > 0); assert.equal(r2.messages[0].role, 'user');
});
t('getModels: кэш с TTL, фолбэк на статический список при ошибке, ключ обязателен', async () => {
  const st = makeMemoryStore(); let calls = 0; let now = 1e6;
  const fetchImpl = async () => { calls++; return new Response(JSON.stringify({ data: [{ id: 'gpt-x', context_length: 1000 }, { id: 'bge-m3', context_length: 0 }] }), { headers: { 'content-type': 'application/json' } }); };
  const p = pById('ovh');
  let r = await getModels(p, { store: st, fetchImpl, now: () => now }); assert.equal(r.source, 'live'); assert.deepEqual(r.list.map(m => m.id), ['gpt-x']);
  r = await getModels(p, { store: st, fetchImpl, now: () => now + 1000 }); assert.equal(r.source, 'cache'); assert.equal(calls, 1);
  const bad = async () => new Response('x', { status: 500 });
  r = await getModels(p, { store: st, fetchImpl: bad, now: () => now + 1000, force: true }); assert.ok(r.error); assert.equal(r.list[0].id, 'gpt-x');
  r = await getModels(p, { store: makeMemoryStore(), fetchImpl: bad }); assert.equal(r.source, 'static'); assert.equal(r.list.length, 12);
  r = await getModels(pById('groq'), { store: st, fetchImpl }); assert.ok(r.error && /ключ/.test(r.error));
});

t('classify: reasoning-only ответ = модель работает', () => { assert.equal(classify(new StreamError('x', { reasoningOnly: true }), 1000).s, 'ok'); assert.equal(classify(new HttpError(429, 'x'), 1).s, 'limited'); assert.equal(classify(new HttpError(401, 'x'), 1).s, 'fail'); });

t('картинки: prepareMessages несёт _images, buildRequest → content-массив image_url; supportsVision', async () => {
  const { supportsVision } = await import('../js/providers.js');
  const h = [{ role: 'user', content: 'что тут?', _images: ['data:image/jpeg;base64,AAA'] }, { role: 'assistant', content: 'ок' }, { role: 'user', content: 'ещё' }];
  const r = prepareMessages(h); assert.deepEqual(r.messages[0].images, ['data:image/jpeg;base64,AAA']); assert.ok(!('images' in r.messages[1]));
  const b = JSON.parse(buildRequest(pById('ovh'), { model: 'Qwen2.5-VL-72B-Instruct', messages: r.messages }).init.body);
  assert.equal(b.messages[0].content[0].type, 'text'); assert.equal(b.messages[0].content[1].image_url.url, 'data:image/jpeg;base64,AAA'); assert.equal(typeof b.messages[1].content, 'string'); assert.ok(!('images' in b.messages[0]));
  assert.ok(supportsVision(pById('ovh'), 'Qwen2.5-VL-72B-Instruct')); assert.ok(!supportsVision(pById('ovh'), 'gpt-oss-20b')); assert.ok(!supportsVision(pById('chat'), 'gpt-4o'));
  // JSON истории не должен содержать картинки
  assert.ok(!JSON.stringify(JSON.parse(JSON.stringify(h[0], (k, v) => (k.startsWith('_') ? undefined : v)))).includes('base64'));
});

t('обрыв соединения посреди потока → понятная ошибка, а не «CORS»', async () => {
  const enc = new TextEncoder();
  const body = new ReadableStream({ start(c) { c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"Нач"}}]}\n\n')); }, pull() { throw new TypeError('network error'); } });
  const f = async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  await assert.rejects(() => requestOnce(pById('chat'), { model: 'm', messages: [{ role: 'user', content: 'x' }] }, { fetchImpl: f }), e => e.name === 'StreamError' && /оборвалось/.test(e.message));
});

let failed = 0;
for (const [name, fn] of tests) { try { await fn(); n++; console.log('  ✓', name); } catch (e) { failed++; console.error('  ✗', name, '\n    ', (e && e.stack || e).toString().split('\n').slice(0, 4).join('\n     ')); } }
console.log(`api/limiter/chats tests: ${n} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
