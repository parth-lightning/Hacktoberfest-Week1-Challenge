const CACHE_NAME = "wildpack-shell-v3";
const SHELL_URL = "/";
const LANDING_TEMPLATE_URL = "/landing-pages/inner-green-3d.html";
const LANDING_ASSETS = [
  "/landing-pages/inner-green-assets/three.min.js",
  "/landing-pages/inner-green-assets/lexend-latin.woff2",
  "/landing-pages/inner-green-assets/card-ethos.jpg",
  "/landing-pages/inner-green-assets/card-ecostove.jpg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const response = await fetch(SHELL_URL);
      if (!response.ok) {
        throw new Error(`Could not cache the app shell (${response.status}).`);
      }
      const html = await response.clone().text();
      await cache.put(SHELL_URL, response);
      await cache.addAll([
        "/manifest.webmanifest",
        "/icons/wildpack.svg",
        LANDING_TEMPLATE_URL,
        ...LANDING_ASSETS,
      ]);

      const entryAssets = Array.from(
        html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g),
        (match) => match[1],
      ).filter((asset) => typeof asset === "string");
      await Promise.all(
        entryAssets.map(async (asset) => {
          const assetUrl = new URL(asset, self.location.origin);
          if (assetUrl.origin !== self.location.origin) return;
          const assetResponse = await fetch(assetUrl);
          if (!assetResponse.ok) {
            throw new Error(`Could not cache app asset ${assetUrl.pathname}.`);
          }
          await cache.put(assetUrl, assetResponse);
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(async (keys) => {
      await Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    }),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            return caches.open(CACHE_NAME).then(async (cache) => {
              await cache.put(request, response.clone());
              await cache.put(SHELL_URL, response.clone());
              return response;
            });
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const shell = await caches.match(SHELL_URL);
          if (shell) return shell;
          return new Response("WildPack is offline and its app shell is not cached yet.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }),
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) {
        await cache.put(request, response.clone());
      }
      return response;
    }),
  );
});
