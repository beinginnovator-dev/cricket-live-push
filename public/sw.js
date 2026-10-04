self.addEventListener('install',e=>{e.waitUntil(self.skipWaiting())});
self.addEventListener('activate',e=>{e.waitUntil(self.clients.claim())});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==self.location.origin)return;
  if(/\/(api\/)?(live-public|live|presence|chat|fans|react|admin|health)(\?|$)/i.test(u.pathname))return;
  e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));
});
