/* Необязательный service worker: «сначала сеть, при её отсутствии — кэш». Нужен, чтобы приложение открывалось офлайн
 * (например, вместе с локальной моделью, уже скачанной в браузер). API-запросы к провайдерам и любые кросс-доменные запросы
 * (в т.ч. реклама Google: pagead2.googlesyndication.com, googleads.g.doubleclick.net) он НЕ перехватывает и не кэширует. */
const CACHE = 'fah-v2-shell-2.5-log';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener('fetch', e => {
  const r = e.request; const u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;      // только файлы самого приложения (чужие домены — мимо SW)
  if (u.pathname.endsWith('/ads.txt')) return;                        // ads.txt всегда напрямую с сервера
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(r);
      if (res.ok && res.type === 'basic') cache.put(r, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(r, { ignoreSearch: true }) || (r.mode === 'navigate' ? await cache.match('./') || await cache.match('index.html') : null);
      if (hit) return hit;
      throw err;
    }
  })());
});
