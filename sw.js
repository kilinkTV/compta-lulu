const CACHE_NAME = "compta-lulu-v17";
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
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  // Requête neuve (et non celle de navigation) pour forcer la revalidation de façon identique sur tous les navigateurs.
  event.respondWith(
    fetch(new Request(req.url, { cache: "no-cache" }))
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return response;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  const title = data.title || "Compta Lulu";
  const body = data.body || "";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "./icons/icon-192.png",
      badge: "./icons/icon-192.png",
      data: { url: "./" }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(event.notification.data && event.notification.data.url || "./");
    })
  );
});
