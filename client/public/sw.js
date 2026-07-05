// Service worker minimal : met en cache la coquille de l'app pour l'installer
// et la lancer hors-ligne. Le temps réel (Socket.IO) passe toujours par le réseau.
const CACHE = "puzzle-v1";
const SHELL = ["/", "/index.html", "/icon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // Jamais de cache pour le temps réel ni les requêtes non-GET.
  if (request.method !== "GET" || url.pathname.startsWith("/socket.io")) return;

  // Navigations : réseau d'abord, repli sur la coquille en cache (hors-ligne).
  if (request.mode === "navigate") {
    e.respondWith(
      fetch(request)
        .then((res) => {
          caches.open(CACHE).then((c) => c.put("/", res.clone()));
          return res;
        })
        .catch(() => caches.match("/"))
    );
    return;
  }

  // Autres ressources same-origin : cache d'abord, mise à jour en arrière-plan.
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((res) => {
            if (res.ok) caches.open(CACHE).then((c) => c.put(request, res.clone()));
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});
