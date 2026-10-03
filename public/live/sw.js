// Minimal service worker for PWA installability
const CACHE = "live-v1";
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/live/", "/live/index.html"])));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});
self.addEventListener("fetch", (e) => {
  // Network-first for live data, cache for shell
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
