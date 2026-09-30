import assert from 'node:assert/strict';
import { createTelemetry, normalizeBackendUrl, redact, newUuid } from '../js/telemetry.js';
import { makeMemoryStore } from '../js/store.js';

let n = 0; const tests = []; const t = (name, fn) => tests.push([name, fn]);
const mkFetch = (status = 200) => { const calls = []; const f = async (url, init) => { calls.push({ url, init }); return { ok: status < 400, status, json: async () => ({ deleted: 3 }) }; }; f.calls = calls; return f; };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

t('BACKEND_URL пуст → журнал выключен, ничего не отправляется, уведомление не нужно', async () => {
  const f = mkFetch(); const tel = createTelemetry({ backendUrl: '', store: makeMemoryStore(), fetchFn: f });
  assert.equal(tel.available, false); assert.equal(tel.needsAsk, false); assert.equal(tel.enabled, false);
  tel.setConsent(true); assert.equal(tel.enabled, false);
  assert.equal(await tel.logExchange({ chatId: 'c', userText: 'привет' }), false); assert.equal(f.calls.length, 0);
});
t('normalizeBackendUrl: только https или localhost', () => {
  assert.equal(normalizeBackendUrl('https://a.example.com/'), 'https://a.example.com');
  assert.equal(normalizeBackendUrl('http://127.0.0.1:8080'), 'http://127.0.0.1:8080');
  for (const bad of ['http://evil.com', 'ftp://x', 'https://a.com/path', 'javascript:alert(1)', 'https://a.com@evil.com', 'https://user:pw@a.com']) assert.equal(normalizeBackendUrl(bad), '', bad);
});
t('без согласия ничего не уходит; «Не сохранять» = ничего не уходит', async () => {
  const f = mkFetch(); const tel = createTelemetry({ backendUrl: 'https://x.example.com', store: makeMemoryStore(), fetchFn: f });
  assert.equal(tel.needsAsk, true);
  assert.equal(await tel.logExchange({ chatId: 'c', userText: 'a', assistantText: 'b' }), false);
  tel.setConsent(false); assert.equal(tel.needsAsk, false); assert.equal(tel.consent, 'no');
  assert.equal(await tel.logExchange({ chatId: 'c', userText: 'a', assistantText: 'b' }), false); assert.equal(f.calls.length, 0);
});
t('с согласием: POST /api/log, keepalive, без cookie, поля события', async () => {
  const f = mkFetch(); const st = makeMemoryStore(); const tel = createTelemetry({ backendUrl: 'https://x.example.com/', store: st, fetchFn: f, lang: 'ru-RU', now: () => 1234567890123 });
  tel.setConsent(true);
  assert.equal(await tel.logExchange({ chatId: 'chat_1', provider: 'ovh', model: 'gpt-oss-20b', userText: 'Привет', assistantText: 'Здравствуйте' }), true);
  const c = f.calls[0]; assert.equal(c.url, 'https://x.example.com/api/log'); assert.equal(c.init.method, 'POST'); assert.equal(c.init.keepalive, true); assert.equal(c.init.credentials, 'omit');
  const b = JSON.parse(c.init.body);
  assert.match(b.session_id, UUID); assert.equal(b.chat_id, 'chat_1'); assert.equal(b.provider, 'ovh'); assert.equal(b.model, 'gpt-oss-20b');
  assert.equal(b.user_text, 'Привет'); assert.equal(b.assistant_text, 'Здравствуйте'); assert.equal(b.lang, 'ru-RU'); assert.equal(b.ts, 1234567890123);
  assert.equal(b.session_id, tel.sessionId);                   // стабилен между вызовами
  assert.deepEqual(Object.keys(b).sort(), ['assistant_text', 'chat_id', 'lang', 'model', 'provider', 'session_id', 'slot', 'ts', 'user_text']);
});
t('ключи/URL/системный промпт не отправляются; ключ из текста вырезается', async () => {
  const f = mkFetch(); const tel = createTelemetry({ backendUrl: 'https://x.example.com', store: makeMemoryStore(), fetchFn: f, getSecrets: () => ['sk-SECRET-KEY-123456', 'https://my.private/v1'] });
  tel.setConsent(true);
  await tel.logExchange({ chatId: 'c', provider: 'custom', model: 'm', userText: 'мой ключ sk-SECRET-KEY-123456 и https://my.private/v1', assistantText: 'ok' });
  const raw = f.calls[0].init.body;
  assert.ok(!raw.includes('sk-SECRET-KEY-123456') && !raw.includes('my.private')); assert.ok(raw.includes('[ключ скрыт]'));
  assert.ok(!('key' in JSON.parse(raw)) && !('system' in JSON.parse(raw)) && !('apiKey' in JSON.parse(raw)));
});
t('сбой сети / 500 → false, без исключений', async () => {
  const bad = async () => { throw new TypeError('Failed to fetch'); };
  const tel = createTelemetry({ backendUrl: 'https://x.example.com', store: makeMemoryStore(), fetchFn: bad }); tel.setConsent(true);
  assert.equal(await tel.logExchange({ chatId: 'c', userText: 'x', assistantText: 'y' }), false);
  const t2 = createTelemetry({ backendUrl: 'https://x.example.com', store: makeMemoryStore(), fetchFn: mkFetch(500) }); t2.setConsent(true);
  assert.equal(await t2.logExchange({ chatId: 'c', userText: 'x' }), false);
});
t('лимит длины текста 20000; пустые события не отправляются', async () => {
  assert.equal(redact('я'.repeat(30000)).length, 20000);
  const f = mkFetch(); const tel = createTelemetry({ backendUrl: 'https://x.example.com', store: makeMemoryStore(), fetchFn: f }); tel.setConsent(true);
  assert.equal(await tel.logExchange({ chatId: 'c', userText: '   ', assistantText: '' }), false);
  await tel.logExchange({ chatId: 'c', userText: 'ю'.repeat(50000), assistantText: 'ю'.repeat(50000) }); assert.equal(JSON.parse(f.calls[0].init.body).user_text.length, 20000);
  assert.equal(f.calls[0].init.keepalive, false);          // тело > 60 КБ: без keepalive (лимит браузера 64 КиБ)
});
t('deleteMyData: DELETE /api/session/{id}, затем новый session_id', async () => {
  const f = mkFetch(); const tel = createTelemetry({ backendUrl: 'https://x.example.com', store: makeMemoryStore(), fetchFn: f }); tel.setConsent(true);
  const old = tel.sessionId; const r = await tel.deleteMyData();
  assert.deepEqual(r, { ok: true, deleted: 3 }); assert.equal(f.calls[0].url, 'https://x.example.com/api/session/' + old); assert.equal(f.calls[0].init.method, 'DELETE');
  assert.notEqual(tel.sessionId, old);
  const bad = createTelemetry({ backendUrl: 'https://x.example.com', store: makeMemoryStore(), fetchFn: mkFetch(500) });
  assert.equal((await bad.deleteMyData()).ok, false);
});
t('newUuid: v4 и запасной вариант без randomUUID', () => { assert.match(newUuid(), UUID); assert.match(newUuid({ getRandomValues: a => a.fill(7) }), UUID); });

let failed = 0;
for (const [name, fn] of tests) { try { await fn(); n++; } catch (e) { failed++; console.log('✗ ' + name + '\n  ' + (e && e.message)); } }
console.log(`telemetry tests: ${n} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
