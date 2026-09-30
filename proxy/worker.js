/* Free AI Hub — ОПЦИОНАЛЬНЫЙ мини-прокси для Cloudflare Workers (модульный синтаксис).
 * Зачем: некоторые публичные бесплатные шлюзы (например Kilo Gateway) принимают запросы без ключа,
 * но не отдают CORS-заголовки, поэтому из браузера напрямую к ним не обратиться. Этот воркер просто
 * пересылает запрос и добавляет CORS. Приложение работает и без него.
 *
 * Маршруты:   https://<ваш-воркер>/<имя>/<путь>   →   <апстрим>/<путь>
 *             например /kilo/chat/completions → https://api.kilo.ai/api/gateway/chat/completions
 * Безопасность: работают ТОЛЬКО апстримы из белого списка ниже; ключи не хранятся и не подставляются;
 *   заголовок Authorization пересылается как есть (если вы сами ввели ключ в приложении);
 *   при желании ограничьте сайты переменной ALLOWED_ORIGINS (через запятую, например "https://my.site").
 * Не превращайте его в открытый прокси: не добавляйте произвольные адреса и не подставляйте чужие ключи.
 * Не используйте для обхода ограничений сервисов (лимиты — на IP воркера, они общие для всех пользователей).
 */
const UPSTREAMS = {
  kilo: 'https://api.kilo.ai/api/gateway'          // бесплатные модели без ключа, ≈200 запросов/час на IP; может обучаться на промптах
};

const FORWARD_HEADERS = ['content-type', 'authorization', 'accept'];

function corsHeaders(origin, env) {
  const allowed = (env && env.ALLOWED_ORIGINS ? String(env.ALLOWED_ORIGINS) : '*').split(',').map(s => s.trim()).filter(Boolean);
  const ok = allowed.includes('*') || allowed.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? (allowed.includes('*') ? '*' : origin) : 'null',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, authorization, accept',
    'Access-Control-Expose-Headers': 'retry-after, x-ratelimit-remaining, x-request-id',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin'
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/([a-z0-9-]+)(\/.*)?$/);
    if (!m) return new Response('Free AI Hub proxy: /<upstream>/<path>. Upstreams: ' + Object.keys(UPSTREAMS).join(', '), { status: 200, headers: cors });
    const base = UPSTREAMS[m[1]];
    if (!base) return new Response(JSON.stringify({ error: 'unknown upstream' }), { status: 404, headers: { ...cors, 'content-type': 'application/json' } });
    if (request.method !== 'GET' && request.method !== 'POST') return new Response('method not allowed', { status: 405, headers: cors });
    if (cors['Access-Control-Allow-Origin'] === 'null' && origin) return new Response('origin not allowed', { status: 403, headers: cors });

    const headers = new Headers();
    for (const h of FORWARD_HEADERS) { const v = request.headers.get(h); if (v) headers.set(h, v); }
    const upstream = await fetch(base + (m[2] || '') + url.search, { method: request.method, headers, body: request.method === 'POST' ? request.body : undefined, duplex: 'half' });
    const out = new Headers(upstream.headers);
    for (const [k, v] of Object.entries(cors)) out.set(k, v);
    out.delete('content-security-policy'); out.delete('cross-origin-resource-policy'); out.delete('cross-origin-embedder-policy'); out.delete('cross-origin-opener-policy');
    return new Response(upstream.body, { status: upstream.status, headers: out });
  }
};
