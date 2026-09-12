const CACHE_NAME = 'noten-scanner-v2';
const STATIC_ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.json'
];

const CDN_ASSETS = [
  'https://docs.opencv.org/4.8.0/opencv.js',
  'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then(response => {
      if (response) return response;
      return fetch(e.request).then(fetchResponse => {
        // Cache CDN-Ressourcen nach dem ersten Laden
        if (e.request.url.includes('opencv.org') || e.request.url.includes('unpkg.com')) {
          return caches.open(CACHE_NAME).then(cache => {
            cache.put(e.request, fetchResponse.clone());
            return fetchResponse;
          });
        }
        return fetchResponse;
      });
    })
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});