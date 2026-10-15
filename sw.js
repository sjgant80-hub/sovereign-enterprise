// sw.js — offline after the first visit. Network first (always the newest kernel when online), the cache when not.
// Every request is revalidated with the server (cache: 'no-cache' — a cheap 304 when nothing changed): the browser's own
// HTTP cache must never hand back a ten-minute-old module beside a fresh page, or a returning visitor runs a mix of two
// versions of the company right after it is updated.
const CACHE = 'sovereign-enterprise-v3';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin) return;
  e.respondWith(fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request).then((m) => m || new Response('offline', { status: 503 }))));
});
