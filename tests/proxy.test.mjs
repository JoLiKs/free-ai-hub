import assert from 'node:assert/strict';
import worker from '../proxy/worker.js';
let calls = [];
globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return new Response('{"ok":1}', { status: 200, headers: { 'content-type': 'application/json', 'content-security-policy': 'x' } }); };
const R = (path, init = {}) => new Request('https://proxy.test' + path, init);
let n = 0; const t = async (name, fn) => { try { await fn(); n++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, e.message); process.exitCode = 1; } };

await t('preflight → 204 + CORS', async () => { const r = await worker.fetch(R('/kilo/chat/completions', { method: 'OPTIONS', headers: { Origin: 'https://a.b' } }), {}); assert.equal(r.status, 204); assert.equal(r.headers.get('access-control-allow-origin'), '*'); });
await t('POST пересылается на апстрим из белого списка', async () => { calls = []; const r = await worker.fetch(R('/kilo/chat/completions?x=1', { method: 'POST', headers: { 'content-type': 'application/json', Origin: 'https://a.b', cookie: 'secret' }, body: '{}' }), {}); assert.equal(r.status, 200); assert.equal(calls[0].url, 'https://api.kilo.ai/api/gateway/chat/completions?x=1'); assert.equal(r.headers.get('access-control-allow-origin'), '*'); assert.equal(r.headers.get('content-security-policy'), null); assert.equal(new Headers(calls[0].init.headers).get('cookie'), null); });
await t('неизвестный апстрим → 404 (не открытый прокси)', async () => { calls = []; const r = await worker.fetch(R('/evil/x', { method: 'POST', body: '{}' }), {}); assert.equal(r.status, 404); assert.equal(calls.length, 0); });
await t('ALLOWED_ORIGINS блокирует чужие сайты', async () => { calls = []; const r = await worker.fetch(R('/kilo/models', { headers: { Origin: 'https://bad.site' } }), { ALLOWED_ORIGINS: 'https://good.site' }); assert.equal(r.status, 403); assert.equal(calls.length, 0); const ok = await worker.fetch(R('/kilo/models', { headers: { Origin: 'https://good.site' } }), { ALLOWED_ORIGINS: 'https://good.site' }); assert.equal(ok.status, 200); assert.equal(ok.headers.get('access-control-allow-origin'), 'https://good.site'); });
await t('DELETE/PUT запрещены', async () => { const r = await worker.fetch(R('/kilo/x', { method: 'DELETE' }), {}); assert.equal(r.status, 405); });
console.log(`proxy tests: ${n} passed`);
