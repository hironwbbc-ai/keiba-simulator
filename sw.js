const CACHE="keiba-v91";
self.addEventListener("install",e=>e.waitUntil(self.skipWaiting()));
self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));
self.addEventListener("fetch",e=>{
  if(new URL(e.request.url).pathname.endsWith("/data/jra_daily.json")) return;
  e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));
});
