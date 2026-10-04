self.addEventListener('install', e => e.waitUntil(self.skipWaiting()));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin) return;
  // Never cache API or the live viewer HTML (always network)
  if (/\/(api\/)?(live-public|live|presence|chat|fans|react|admin|health|floats|predictions|ws)(\?|$)/i.test(u.pathname)) return;
  if (/live\.html$/i.test(u.pathname) || u.pathname === '/live') return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
