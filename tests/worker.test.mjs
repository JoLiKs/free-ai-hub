/* Тест _worker.js (Cloudflare Pages) с подменённым fetch: node tests/worker.test.mjs */
import assert from 'node:assert/strict';
import worker, { BACKEND, isProxied, isShareApi, isImgApi, shareViewId, imageFile, imageComplete} from '../_worker.js';

const SECRET = 'k'.repeat(40);
let calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  const h = new Headers({ 'content-type': 'application/json', connection: 'close', 'transfer-encoding': 'chunked', server: 'nginx', 'cache-control': 'public, max-age=99' });
  h.append('set-cookie', '__Host-fah_admin=abc; Max-Age=28800; Path=/; HttpOnly; Secure; SameSite=strict');
  h.append('set-cookie', 'other=1; Path=/');
  if (String(url).includes('/admin/panel/') && String(url).endsWith('redir')) { h.set('location', BACKEND + '/admin/'); return new Response(null, { status: 302, headers: h }); }
  return new Response('{"ok":true}', { status: 200, headers: h });
};
const assets = []; const env = { FAH_PROXY_SECRET: SECRET, ASSETS: { fetch: async r => { assets.push(new URL(r.url).pathname); return new Response('asset'); } } };
const req = (path, init = {}, host = 'aihubai.site') => new Request('https://' + host + path, init);
const run = (r, e = env) => worker.fetch(r, e);
let n = 0; const t = async (name, fn) => { calls = []; assets.length = 0; await fn(); n++; console.log('  ok', name); };

await t('chat and login page go to static assets, nothing proxied', async () => {
  for (const p of ['/', '/index.html', '/js/app.js', '/admin', '/admin/', '/admin/login.js', '/admin/index.html', '/api/log', '/administrator', '/api/administrator', '/sw.js']) {
    const r = await run(req(p)); assert.equal(await r.text(), 'asset', p);
  }
  assert.equal(calls.length, 0); assert.equal(assets.length, 11);
});
await t('unknown /admin/* paths -> 404 (no SPA fallback)', async () => {
  for (const p of ['/admin/app.js', '/admin/admin.css', '/admin/foo', '/admin/panel2', '/api/admin2/x'.replace('2', '')]) { const r = await run(req(p)); assert.ok(r.status === 404 || calls.length === 1, p); }
  assert.equal((await run(req('/admin/app.js'))).status, 404); assert.equal(assets.filter(p => p.startsWith('/admin/app')).length, 0);
});
await t('whitelisted paths proxied to hard-coded backend', async () => {
  for (const [p, want] of [['/api/admin/login', '/api/admin/login'], ['/api/admin/sessions?limit=5&q=a%20b', '/api/admin/sessions?limit=5&q=a%20b'], ['/admin/panel/', '/admin/panel/'], ['/admin/panel', '/admin/panel'], ['/admin/panel/app.js', '/admin/panel/app.js']]) {
    calls.length = 0; const r = await run(req(p)); assert.equal(r.status, 200, p);
    assert.equal(calls.length, 1); assert.equal(calls[0].url, BACKEND + want);
  }
  assert.equal(assets.length, 0);
});
await t('secret + client ip set; spoofed client headers dropped; allowlist only', async () => {
  await run(req('/api/admin/me', { headers: { 'cf-connecting-ip': '203.0.113.9', 'x-fah-client-ip': '6.6.6.6', 'x-fah-proxy-secret': 'evil', 'x-forwarded-for': '7.7.7.7', 'x-real-ip': '8.8.8.8',
    cookie: '__Host-fah_admin=tok', origin: 'https://aihubai.site', 'x-csrf-token': 'c', 'user-agent': 'UA', connection: 'keep-alive', 'x-custom': 'zzz', authorization: 'Bearer x', host: 'evil.test' } }));
  const h = calls[0].init.headers;
  assert.equal(h.get('x-fah-proxy-secret'), SECRET); assert.equal(h.get('x-fah-client-ip'), '203.0.113.9');
  assert.equal(h.get('cookie'), '__Host-fah_admin=tok'); assert.equal(h.get('origin'), 'https://aihubai.site'); assert.equal(h.get('x-csrf-token'), 'c');
  for (const k of ['x-forwarded-for', 'x-real-ip', 'x-custom', 'authorization', 'connection', 'cf-connecting-ip', 'host']) assert.equal(h.get(k), null, k);
  assert.equal(calls[0].init.redirect, 'manual');
});
await t('no cf-connecting-ip: client ip header is not forged from input', async () => {
  await run(req('/api/admin/me', { headers: { 'x-fah-client-ip': '6.6.6.6' } }));
  assert.equal(calls[0].init.headers.get('x-fah-client-ip'), null);
});
await t('POST body forwarded; set-cookie passed unchanged (multiple); hop headers and caching dropped', async () => {
  const r = await run(req('/api/admin/login', { method: 'POST', body: '{"password":"x"}', headers: { 'content-type': 'application/json' } }));
  assert.equal(new TextDecoder().decode(calls[0].init.body), '{"password":"x"}'); assert.equal(calls[0].init.method, 'POST');
  const sc = r.headers.getSetCookie(); assert.equal(sc.length, 2);
  assert.equal(sc[0], '__Host-fah_admin=abc; Max-Age=28800; Path=/; HttpOnly; Secure; SameSite=strict');
  assert.equal(r.headers.get('cache-control'), 'no-store, no-transform'); assert.equal(r.headers.get('connection'), null); assert.equal(r.headers.get('server'), null);
  assert.match(r.headers.get('x-robots-tag'), /noindex/);
});
await t('backend redirect Location rewritten to same-origin relative', async () => {
  const r = await run(req('/admin/panel/redir')); assert.equal(r.status, 302); assert.equal(r.headers.get('location'), '/admin/');
});
await t('no open proxy / traversal / host injection', async () => {
  for (const p of ['/api/admin/..%2f..%2fapi/health', '/admin/panel/%2e%2e/%2e%2e/x', '/admin/panel/..%5cfoo', '/api/admin/%2f%2fevil.com/x', '/admin/panel/%00']) {
    calls.length = 0; const r = await run(req(p)); assert.ok(r.status === 404 || r.status === 200 && (await r.clone().text()) === 'asset', p + ' ' + r.status);
    for (const c of calls) assert.ok(c.url.startsWith(BACKEND + '/api/admin') || c.url.startsWith(BACKEND + '/admin/panel'), c.url);
  }
  for (const p of ['/admin/panel/../../api/health', '/admin/panel/./../x']) { calls.length = 0; await run(req(p)); for (const c of calls) assert.ok(!c.url.includes('..')); }
  calls.length = 0; await run(new Request('https://aihubai.site/api/admin//evil.com/x')); for (const c of calls) assert.ok(c.url.startsWith(BACKEND + '/api/admin/'));
  assert.ok(!isProxied('/api/health') && !isProxied('/api/log') && !isProxied('/admin') && !isProxied('/admin/') && !isProxied('/api/administrator'));
});
await t('methods / body size limits', async () => {
  assert.equal((await run(req('/api/admin/me', { method: 'PATCH', body: 'x' }))).status, 405);
  assert.equal((await run(req('/api/admin/purge', { method: 'POST', body: 'x'.repeat(70000) }))).status, 413);
  assert.equal(calls.length, 0);
});
await t('missing/short secret -> 503 (fail closed), static unaffected', async () => {
  for (const e of [{ ASSETS: env.ASSETS }, { ...env, FAH_PROXY_SECRET: 'short' }]) assert.equal((await run(req('/api/admin/me'), e)).status, 503);
  assert.equal(calls.length, 0); assert.equal(await (await run(req('/'), { ASSETS: env.ASSETS })).text(), 'asset');
});
await t('admin area only on custom domains: pages.dev -> 404', async () => {
  for (const host of ['free-ai-hub-94p.pages.dev', 'abc.free-ai-hub-94p.pages.dev']) for (const p of ['/admin', '/admin/', '/admin/login.js', '/api/admin/me', '/admin/panel/']) assert.equal((await run(req(p, {}, host))).status, 404, host + p);
  assert.equal(await (await run(req('/', {}, 'free-ai-hub-94p.pages.dev'))).text(), 'asset');
  assert.equal((await run(req('/admin/', {}, 'www.aihubai.site'))).status, 200);
  assert.equal(calls.length, 0);
});
await t('backend down -> 502', async () => {
  const f = globalThis.fetch; globalThis.fetch = async () => { throw new Error('x'); };
  assert.equal((await run(req('/api/admin/me'))).status, 502); globalThis.fetch = f;
});
await t('site-config: proxies popunder flag, fails closed to false', async () => {
  const f = globalThis.fetch;
  const mk = body => async (url, init) => { calls.push({ url: String(url), init }); return typeof body === 'function' ? body() : new Response(body, { status: 200 }); };
  globalThis.fetch = mk('{"popunder":true,"banner160":true,"imggen":false}');
  let r = await run(req('/api/site-config')); assert.deepEqual(await r.json(), { popunder: true, banner160: true, imggen: false, imggen_paid: false });
  assert.equal(calls[0].url, BACKEND + '/api/site-config'); assert.ok(!new Headers(calls[0].init.headers).has('x-fah-proxy-secret'));
  assert.equal(r.headers.get('cache-control'), 'no-store');
  r = await run(req('/api/site-config', {}, 'free-ai-hub-94p.pages.dev')); assert.deepEqual(await r.json(), { popunder: true, banner160: true, imggen: false, imggen_paid: false });
  for (const b of ['{"popunder":"true"}', '{}', 'garbage', () => new Response('x', { status: 500 }), () => { throw new Error('down'); }]) {
    globalThis.fetch = mk(b); assert.deepEqual(await (await run(req('/api/site-config'))).json(), { popunder: false, banner160: false, imggen: true, imggen_paid: false });
  }
  globalThis.fetch = f;
  assert.equal((await run(req('/api/site-config', { method: 'POST', body: 'x' }))).status, 405);
});
await t('site-config: imggen_paid passed through as boolean only', async () => {
  const f = globalThis.fetch; globalThis.fetch = async () => new Response('{"imggen_paid":true,"pollinations_key":"sk_x"}', { status: 200 });
  const j = await (await run(req('/api/site-config'))).json(); globalThis.fetch = f;
  assert.equal(j.imggen_paid, true); assert.ok(!('pollinations_key' in j));
});
const IMG = '0123456789abcdef0123456789abcdef.jpg';
await t('img API: POST /api/img and GET /api/img/<id> proxied without admin cookie; bad paths rejected', async () => {
  let r = await run(req('/api/img', { method: 'POST', body: '{"prompt":"x"}', headers: { origin: 'https://aihubai.site', cookie: '__Host-fah_admin=zzz', 'cf-connecting-ip': '198.51.100.9' } }));
  assert.equal(r.status, 200); const h = new Headers(calls[0].init.headers);
  assert.equal(calls[0].url, BACKEND + '/api/img'); assert.ok(!h.has('cookie')); assert.equal(h.get('x-fah-client-ip'), '198.51.100.9');
  assert.equal(r.headers.get('cache-control'), 'no-store, no-transform');
  calls = [];
  for (const p of ['/api/img/x.jpg', '/api/img/' + IMG + '/x', '/api/img/..%2f..%2fadmin', '/api/img/', '/api/img/' + IMG.replace('.jpg', '.exe')]) assert.equal((await run(req(p))).status, 404, p);
  assert.equal((await run(req('/api/img'))).status, 405);
  assert.equal((await run(req('/api/img/' + IMG, { method: 'POST', body: 'x' }))).status, 405);
  assert.equal(calls.length, 0);
  assert.ok(isImgApi('/api/img') && isImgApi('/api/img/' + IMG) && !isImgApi('/api/img/a.jpg'));
});
await t('img file: fetched in 12 KB ranges, validated; short/stalled chunks retried; broken never served/cached', async () => {
  const f = globalThis.fetch; const N = 30000; const full = new Uint8Array(N); for (let i = 0; i < N; i++) full[i] = i % 251; full.set([0xff, 0xd8, 0xff], 0); full[N - 2] = 0xff; full[N - 1] = 0xd9;
  const cache = new Map(); const C = { match: async k => cache.get(k.url), put: async (k, v) => { cache.set(k.url, v); } };
  let fail = new Set(), served = []; const mode = { broken: false };
  globalThis.fetch = async (u, init) => {
    calls.push({ url: String(u), init });
    const h = new Headers(init.headers); const [, a, b] = /bytes=(\d+)-(\d+)/.exec(h.get('range')); const from = +a, to = Math.min(+b, N - 1);
    const tag = from + ':' + served.filter(x => x === from).length; served.push(from);
    if (fail.has(tag)) throw new DOMException('t', 'TimeoutError');
    let part = full.slice(from, to + 1); if (mode.broken && from === 0) part = part.slice(0, 100);
    return new Response(part, { status: 206, headers: { 'content-type': 'image/jpeg', 'content-range': `bytes ${from}-${to}/${N}` } });
  };
  const go = () => imageFile(req('/api/img/' + IMG), env, new URL('https://aihubai.site/api/img/' + IMG), { cache: C });
  fail = new Set(['12288:0']); calls = [];
  let r = await go(); assert.equal(r.status, 200); const got = new Uint8Array(await r.arrayBuffer());
  assert.equal(got.length, N); assert.deepEqual(got, full); assert.equal(r.headers.get('content-length'), String(N));
  assert.equal(calls.length, 4);   // 3 куска + 1 повтор
  assert.equal(new Headers(calls[0].init.headers).get('x-fah-proxy-secret'), SECRET);
  calls = []; assert.equal((await go()).status, 200); assert.equal(calls.length, 0);   // из кэша
  cache.clear(); served = []; mode.broken = true; r = await go(); assert.equal(r.status, 503); assert.equal(cache.size, 0);
  mode.broken = false; served = []; fail = new Set(['24576:0', '24576:1', '24576:2']); r = await go(); assert.equal(r.status, 503); assert.equal(cache.size, 0);
  globalThis.fetch = async () => new Response('nf', { status: 404 }); assert.equal((await go()).status, 404);
  assert.ok(!imageComplete(full.slice(0, 8000), 'image/jpeg') && imageComplete(full, 'image/jpeg', String(N)) && !imageComplete(full, 'image/jpeg', '9100'));
  globalThis.fetch = f;
});
const SID = 'Ab3_-xYz0123456Q';
await t('share API: POST /api/share and GET /api/share/<id> proxied on any host, with secret + client IP, without admin cookie', async () => {
  for (const host of ['aihubai.site', 'free-ai-hub-94p.pages.dev']) {
    calls = [];
    const r = await run(req('/api/share', { method: 'POST', body: '{"messages":[]}', headers: { origin: 'https://' + host, cookie: '__Host-fah_admin=zzz', 'x-csrf-token': 't', 'cf-connecting-ip': '198.51.100.9', 'x-fah-client-ip': '1.1.1.1', 'content-type': 'application/json' } }, host));
    assert.equal(r.status, 200); assert.equal(calls.length, 1);
    const h = new Headers(calls[0].init.headers);
    assert.equal(calls[0].url, BACKEND + '/api/share'); assert.equal(h.get('x-fah-proxy-secret'), SECRET); assert.equal(h.get('x-fah-client-ip'), '198.51.100.9');
    assert.equal(h.get('origin'), 'https://' + host); assert.ok(!h.has('cookie') && !h.has('x-csrf-token'));
  }
  calls = []; const g = await run(req('/api/share/' + SID)); assert.equal(g.status, 200); assert.equal(calls[0].url, BACKEND + '/api/share/' + SID);
  assert.equal(g.headers.get('cache-control'), 'no-store, no-transform');
});
await t('share API: bad ids / methods / sizes rejected without calling backend', async () => {
  for (const p of ['/api/share/short', '/api/share/' + SID + 'x', '/api/share/' + SID + '/x', '/api/share/..%2f..%2fadmin', '/api/share/']) assert.equal((await run(req(p))).status, 404, p);
  assert.equal((await run(req('/api/share'))).status, 405);
  assert.equal((await run(req('/api/share/' + SID, { method: 'POST', body: 'x' }))).status, 405);
  assert.equal((await run(req('/api/share/' + SID, { method: 'DELETE' }))).status, 405);
  assert.equal((await run(req('/api/share', { method: 'POST', body: 'x'.repeat(300 * 1024) }))).status, 413);
  assert.equal(calls.length, 0);
  assert.ok(isShareApi('/api/share') && isShareApi('/api/share/' + SID) && !isShareApi('/api/share/abc') && !isProxied('/api/share'));
});
await t('share view: /s/<id> serves static /share/ page, bad ids 404', async () => {
  const r = await run(req('/s/' + SID)); assert.equal(await r.text(), 'asset'); assert.deepEqual(assets, ['/share/']); assert.equal(calls.length, 0);
  for (const p of ['/s/', '/s/abc', '/s/' + SID + '/x', '/s/<script>aaaaaaaaaa']) assert.equal((await run(req(p))).status, 404, p);
  assert.equal(shareViewId('/s/' + SID + '/'), SID); assert.equal(shareViewId('/s/x'), '');
  assets.length = 0; assert.equal(await (await run(req('/share/'))).text(), 'asset');
});
console.log(`${n} worker tests passed`);
