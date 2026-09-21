const CACHE_NAME = "compta-lulu-v5";
const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./pdf.js",
  "./style.css",
  "./manifest.json",
  "./fonts/fonts.css",
  "./fonts/playfair.woff2",
  "./fonts/playfair-italic.woff2",
  "./fonts/lato-400.woff2",
  "./fonts/lato-700.woff2",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Réseau d'abord : si elle a du réseau, elle voit toujours la dernière version
// mise en ligne. Le cache ne sert que de secours hors-ligne.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request, { cache: "no-cache" })
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
