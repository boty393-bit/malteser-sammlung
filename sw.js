/* =========================================
   SERVICE WORKER — Malteser Sammlung
   Ermöglicht Installation als PWA &
   Offline-Fallback für statische Dateien.
   ========================================= */

const CACHE = 'malteser-v1';
const STATIC = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './firebase-config.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// Beim Installieren: statische Dateien cachen
self.addEventListener('install', evt => {
  evt.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

// Alte Caches bereinigen
self.addEventListener('activate', evt => {
  evt.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: Cache-first für eigene Dateien, Network-first für externe APIs
self.addEventListener('fetch', evt => {
  if (evt.request.method !== 'GET') return;

  const url = evt.request.url;

  // Externe APIs nie cachen (Firebase, Google Maps, usw.)
  if (url.includes('firebasedatabase') ||
      url.includes('googleapis.com') ||
      url.includes('gstatic.com') ||
      url.includes('google.com')) {
    return; // browser handles it normally
  }

  // Eigene Dateien: Cache-first
  evt.respondWith(
    caches.match(evt.request).then(cached => cached || fetch(evt.request))
  );
});
