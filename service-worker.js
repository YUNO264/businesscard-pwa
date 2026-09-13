const CACHE = "business-card-pwa-final-v4-3-1";
const APP_FILES = [
  "./","./index.html","./css/style.css",
  "./js/app.js","./js/db.js","./js/backup.js","./js/opencv-loader.js","./js/preprocess.js","./js/ocr.js",
  "./manifest.json","./icons/icon-192.png","./icons/icon-512.png",
  "./tessdata/jpn.traineddata.gz","./tessdata/eng.traineddata.gz"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(APP_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok && new URL(e.request.url).origin === self.location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }))
  );
});
