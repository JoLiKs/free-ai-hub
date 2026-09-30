#!/usr/bin/env node
/* Локальный запуск воркера на Node (для проверки без Cloudflare): node proxy/local-test.mjs [порт]
 * Затем в приложении: провайдер «Свой OpenAI-совместимый» → Base URL http://127.0.0.1:8787/kilo */
import http from 'node:http';
import worker from './worker.js';
const port = +process.argv[2] || 8787;
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const r = new Request('http://127.0.0.1:' + port + req.url, { method: req.method, headers: req.headers, body: req.method === 'POST' ? body : undefined });
  try {
    const out = await worker.fetch(r, { ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || '*' });
    const h = {}; out.headers.forEach((v, k) => { h[k] = v; }); delete h['content-encoding']; delete h['content-length'];
    res.writeHead(out.status, h);
    if (out.body) { const rd = out.body.getReader(); for (;;) { const { value, done } = await rd.read(); if (done) break; res.write(value); } }
    res.end();
  } catch (e) { res.writeHead(502); res.end(String(e)); }
}).listen(port, '127.0.0.1', () => console.log('proxy on http://127.0.0.1:' + port));
