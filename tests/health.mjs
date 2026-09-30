#!/usr/bin/env node
/* Проверка живости бесключевых провайдеров/моделей. Использует те же модули, что и приложение (js/api.js, js/models.js).
 *   node tests/health.mjs                     — все бесключевые провайдеры, живые списки моделей
 *   node tests/health.mjs --provider ovh,llm7 — только выбранные
 *   node tests/health.mjs --origin https://example.app  — послать заголовок Origin (Pollinations зависит от него)
 *   node tests/health.mjs --horde-deep        — реально гонять задачи через AI Horde (по умолчанию — только статус очередей)
 *   node tests/health.mjs --patient           — ждать сброса лимитов (429) и повторять; нужен для честной проверки OVH
 *   node tests/health.mjs --json out.json     — сохранить результат
 * Код возврата 0 всегда, если хотя бы одна модель отвечает (для CI можно добавить --strict). */
import { writeFileSync } from 'node:fs';
import { PROVIDERS } from '../js/providers.js';
import { fetchLive, staticModels, checkModel, checkProvider } from '../js/models.js';
import { makeMemoryStore } from '../js/store.js';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const only = (opt('provider', '') || '').split(',').filter(Boolean);
const origin = opt('origin', '');
const deep = !!opt('horde-deep', false);
const patient = !!opt('patient', false);   // ждать сброса лимитов и повторять (до 3 попыток): для OVH (2 зап./мин/модель)
const outFile = opt('json', '');
const store = makeMemoryStore();

const realFetch = globalThis.fetch;
const fetchImpl = (u, init = {}) => {
  init = Object.assign({}, init); init.headers = Object.assign({}, init.headers);
  if (origin) { init.headers.Origin = origin; init.headers.Referer = origin + '/'; }
  return realFetch(u, init);
};

const icon = { ok: '✓', limited: '~', flaky: '⚠', fail: '✗' };
const rows = []; let okTotal = 0;
console.log(`Free AI Hub — health check · ${new Date().toISOString()}${origin ? ' · Origin ' + origin : ''}\n`);
for (const p of PROVIDERS.filter(x => x.group === 'keyless' && (!only.length || only.includes(x.id)))) {
  let list, src = 'live';
  try { list = p.noModelsEndpoint ? staticModels(p) : await fetchLive(p, { fetchImpl }); if (p.noModelsEndpoint) src = 'static'; }
  catch (e) { list = staticModels(p); src = 'static (список недоступен: ' + e.message.slice(0, 60) + ')'; }
  console.log(`## ${p.name} — моделей в списке: ${list.length} (${src})`);
  let res = {};
  if (p.id === 'horde' && deep) {
    for (const m of list.filter(x => !/heretic|Uncensored/i.test(x.id)).slice(0, 6)) { res[m.id] = await checkModel(p, m.id, { store, fetchImpl }); console.log(` ${icon[res[m.id].s]} ${m.id} — ${res[m.id].s} ${res[m.id].ms} мс ${res[m.id].note}`); }
  } else {
    res = await checkProvider(p, list, {
      store, fetchImpl, maxAttempts: patient ? 3 : 1,
      onProgress: (i, n, mid, r) => console.log(` ${icon[r.s]} ${mid.padEnd(48)} ${r.s.padEnd(8)} ${String(r.ms).padStart(6)} мс ${r.note || ''}`)
    });
  }
  const vals = Object.values(res); const ok = vals.filter(r => r.s === 'ok' || r.s === 'limited').length;
  okTotal += ok; rows.push({ provider: p.id, name: p.name, listed: list.length, checked: vals.length, ok, results: res });
  console.log(`   → работают: ${ok} из ${vals.length}\n`);
}
console.log('Итого:'); for (const r of rows) console.log(`  ${r.name.padEnd(28)} ${r.ok}/${r.checked} (в списке ${r.listed})`);
console.log(`  ВСЕГО работающих бесключевых моделей: ${okTotal}`);
if (outFile) writeFileSync(outFile, JSON.stringify({ date: new Date().toISOString(), origin, rows }, null, 2));
if (opt('strict', false) && okTotal === 0) process.exit(1);
