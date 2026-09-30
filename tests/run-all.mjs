#!/usr/bin/env node
/* Запускает все офлайн-тесты (без сети): node tests/run-all.mjs */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const dir = dirname(fileURLToPath(import.meta.url));
let bad = 0;
for (const f of ['markdown.test.mjs', 'api.test.mjs', 'proxy.test.mjs']) {
  const r = spawnSync(process.execPath, [join(dir, f)], { encoding: 'utf8' });
  const last = (r.stdout || '').trim().split('\n').pop();
  console.log((r.status === 0 ? '✓ ' : '✗ ') + f + ' — ' + last); if (r.status) { bad++; console.log(r.stdout, r.stderr); }
}
process.exit(bad ? 1 : 0);
