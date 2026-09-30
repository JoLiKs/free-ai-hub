import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, cpSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLIENT_RE, isValidClient, isValidSlot, scriptUrl, createAds, ADS_PRIVACY_NOTE } from '../js/ads.js';
import * as cfg from '../js/config.js';
import { makeMemoryStore } from '../js/store.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tests = []; const t = (n, f) => tests.push([n, f]);
/** минимальные фейки window/document: считают добавленные <script> */
const fakeEnv = () => {
  const scripts = [];
  const doc = { head: { appendChild: s => scripts.push(s) }, documentElement: { appendChild: s => scripts.push(s) }, createElement: () => ({ setAttribute() {}, append() {}, style: {} }), getElementById: () => null };
  return { win: {}, doc, scripts };
};

t('по умолчанию в config.js реклама выключена (пустые ADSENSE_CLIENT/SLOT)', () => { assert.equal(cfg.ADSENSE_CLIENT, ''); assert.equal(cfg.ADSENSE_SLOT, ''); });
t('валидный ID издателя', () => { for (const ok of ['ca-pub-1234567890', 'ca-pub-1234567890123456', 'ca-pub-12345678901234567890']) assert.equal(isValidClient(ok), true, ok); });
t('невалидные ID отклоняются (в т.ч. попытки инъекции)', () => {
  for (const bad of ['', ' ', 'ca-pub-123', 'ca-pub-123456789', 'ca-pub-123456789012345678901', 'CA-PUB-1234567890123456', 'pub-1234567890123456', 'ca-pub-1234567890123456 ', ' ca-pub-1234567890123456',
    'ca-pub-1234567890123456\n', 'ca-pub-1234567890123456&x=1', 'ca-pub-1234567890123456"><script>alert(1)</script>', 'ca-pub-12345678901234a6', "ca-pub-1234567890123456'", 'ca-pub-1234567890123456/../x', null, undefined, 1234567890123456, {}, []])
    assert.equal(isValidClient(bad), false, JSON.stringify(bad));
  assert.equal(CLIENT_RE.source, '^ca-pub-\\d{10,20}$');
  assert.equal(scriptUrl('ca-pub-1234567890123456"'), '');
  assert.equal(scriptUrl('ca-pub-1234567890123456'), 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456');
});
t('slot: только цифры', () => { assert.equal(isValidSlot('1234567890'), true); for (const b of ['', 'abc', '12"34567', '1234', '123 45678']) assert.equal(isValidSlot(b), false, b); });
t('выключено (пустой client): ничего не загружается, даже при «согласии»', () => {
  const e = fakeEnv(); const st = makeMemoryStore(); const ads = createAds({ client: '', slot: '1234567890', store: st, win: e.win, doc: e.doc });
  assert.equal(ads.enabled, false); assert.equal(ads.needsAsk, false); assert.equal(ads.slot, '');
  ads.setConsent('personal'); assert.equal(ads.load(), false); assert.equal(e.scripts.length, 0); assert.equal(e.win.adsbygoogle, undefined);
});
t('неверный формат client → тоже выключено', () => {
  const e = fakeEnv(); const ads = createAds({ client: 'ca-pub-12"><img src=x>', store: makeMemoryStore(), win: e.win, doc: e.doc });
  ads.setConsent('personal'); assert.equal(ads.enabled, false); assert.equal(ads.load(), false); assert.equal(e.scripts.length, 0);
});
t('включено, но выбора нет: needsAsk, скрипт НЕ загружается', () => {
  const e = fakeEnv(); const ads = createAds({ client: 'ca-pub-1234567890123456', store: makeMemoryStore(), win: e.win, doc: e.doc });
  assert.equal(ads.enabled, true); assert.equal(ads.needsAsk, true); assert.equal(ads.load(), false); assert.equal(e.scripts.length, 0);
});
t('setConsent принимает только personal/nonpersonal и пишет в fah.settings.adsConsent', () => {
  const mem = new Map(); const storage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: k => mem.delete(k) };
  return import('../js/util.js').then(({ makeStore }) => {
    const ads = createAds({ client: 'ca-pub-1234567890123456', store: makeStore(storage), win: {}, doc: null });
    assert.equal(ads.setConsent('yes'), false); assert.equal(ads.setConsent(''), false); assert.equal(mem.size, 0);
    assert.equal(ads.setConsent('nonpersonal'), true); assert.equal(mem.get('fah.settings.adsConsent'), '"nonpersonal"'); assert.equal(ads.consent, 'nonpersonal');
  });
});
t('согласие personal: скрипт с async+crossorigin и верным src, без NPA', () => {
  const e = fakeEnv(); const ads = createAds({ client: 'ca-pub-1234567890123456', store: makeMemoryStore(), win: e.win, doc: e.doc });
  ads.setConsent('personal'); assert.equal(ads.load(), true); assert.equal(e.scripts.length, 1);
  const s = e.scripts[0]; assert.equal(s.async, true); assert.equal(s.crossOrigin, 'anonymous');
  assert.equal(s.src, 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456');
  assert.equal(e.win.adsbygoogle.requestNonPersonalizedAds, undefined);
  assert.equal(ads.load(), false); assert.equal(e.scripts.length, 1);           // повторно не грузится
});
t('«Только неперсонализированная»: requestNonPersonalizedAds = 1 ставится ДО добавления скрипта', () => {
  const e = fakeEnv(); let flagAtAppend;
  e.doc.head.appendChild = s => { flagAtAppend = e.win.adsbygoogle && e.win.adsbygoogle.requestNonPersonalizedAds; e.scripts.push(s); };
  const ads = createAds({ client: 'ca-pub-1234567890123456', store: makeMemoryStore(), win: e.win, doc: e.doc });
  ads.setConsent('nonpersonal'); assert.equal(ads.load(), true); assert.equal(flagAtAppend, 1);
});
t('ошибки загрузки не пробрасываются (document.head бросает)', () => {
  const e = fakeEnv(); e.doc.head.appendChild = () => { throw new Error('blocked'); };
  const ads = createAds({ client: 'ca-pub-1234567890123456', store: makeMemoryStore(), win: e.win, doc: e.doc });
  ads.setConsent('personal'); assert.doesNotThrow(() => ads.load());
});
t('текст приватности упоминает Google AdSense и cookies', () => { assert.match(ADS_PRIVACY_NOTE, /AdSense/); assert.match(ADS_PRIVACY_NOTE, /cookies/); });
t('index.html / ads.js: googlesyndication не встречается в HTML и не грузится статически; sw.js не трогает чужие домены', () => {
  assert.doesNotMatch(readFileSync(join(root, 'index.html'), 'utf8'), /googlesyndication|adsbygoogle/);
  assert.doesNotMatch(readFileSync(join(root, 'index.html'), 'utf8'), /Content-Security-Policy/i);
  assert.match(readFileSync(join(root, 'sw.js'), 'utf8'), /u\.origin !== location\.origin\) return/);
});
t('set-ads.sh: пишет config.js и ads.txt, отвергает мусор, выключение чистит', () => {
  const d = mkdtempSync(join(tmpdir(), 'ads-')); mkdirSync(join(d, 'js'));
  cpSync(join(root, 'js/config.js'), join(d, 'js/config.js')); cpSync(join(root, 'set-ads.sh'), join(d, 'set-ads.sh'));
  const run = (...a) => spawnSync('bash', [join(d, 'set-ads.sh'), ...a], { encoding: 'utf8' });
  assert.equal(run('ca-pub-1234567890123456', '9876543210').status, 0);
  const c = readFileSync(join(d, 'js/config.js'), 'utf8');
  assert.match(c, /ADSENSE_CLIENT = 'ca-pub-1234567890123456';/); assert.match(c, /ADSENSE_SLOT = '9876543210';/);
  assert.match(c, /BACKEND_URL = 'https:\/\/185-255-133-179\.sslip\.io'/);
  assert.equal(readFileSync(join(d, 'ads.txt'), 'utf8'), 'google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n');
  for (const bad of ["ca-pub-12", "ca-pub-1234567890123456'; alert(1);'", 'pub-1234567890123456', '$(id)']) assert.notEqual(run(bad).status, 0, bad);
  assert.notEqual(run('ca-pub-1234567890123456', 'abc').status, 0);
  assert.match(readFileSync(join(d, 'js/config.js'), 'utf8'), /ADSENSE_CLIENT = 'ca-pub-1234567890123456';/);
  assert.equal(run('').status, 0);
  assert.match(readFileSync(join(d, 'js/config.js'), 'utf8'), /ADSENSE_CLIENT = '';/); assert.equal(existsSync(join(d, 'ads.txt')), false);
});

let bad = 0;
for (const [name, fn] of tests) { try { await fn(); console.log('✓ ' + name); } catch (e) { bad++; console.log('✗ ' + name + '\n  ' + (e && e.message)); } }
console.log(bad ? `${bad} FAILED` : `${tests.length} tests OK`);
process.exit(bad ? 1 : 0);
