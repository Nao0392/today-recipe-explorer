/* スマホ版PWA用: アプリ本体を先に保存し、データと画像は必要になった時だけ保存する。 */
const VERSION = "today-recipe-mobile-v1";
const STATIC_CACHE = `${VERSION}-static`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
const IMAGE_CACHE = `${VERSION}-images`;
const MAX_IMAGE_ENTRIES = 80;

const APP_SHELL = [
  "./",
  "./index.html",
  "./search.html",
  "./favorites.html",
  "./map.html",
  "./mobile.css",
  "./mobile-bootstrap.js",
  "./page-bootstrap.js",
  "./pwa-register.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "../index.html",
  "../search.html",
  "../favorites.html",
  "../atlas-discovery.html",
  "../home.css",
  "../style.css",
  "../search-layout.css",
  "../atlas-discovery.css",
  "../data-adapter.js",
  "../app.js",
  "../viz.js",
  "../resizer.js",
  "../ingredient-readings.js",
  "../vector-core.js",
  "../vector-search.js",
  "../recipe-navigation.js",
  "../favorites.js",
  "../favorite-recommendations.js",
  "../atlas-discovery.js",
  "../images/recipe-explorer-logo.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(STATIC_CACHE).then(cache => cache.addAll(APP_SHELL)));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key.startsWith("today-recipe-mobile-") && !key.startsWith(VERSION))
        .map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

async function limitImageCache() {
  const cache = await caches.open(IMAGE_CACHE);
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_IMAGE_ENTRIES)).map(key => cache.delete(key)));
}

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const response = await fetch(request);
    if (response?.ok) cache.put(request, response.clone());
    return response;
  } catch (_) {
    return (await cache.match(request)) || (await caches.match(request)) || Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const update = fetch(request).then(async response => {
    if (response && (response.ok || response.type === "opaque")) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);
  if (cached) return cached;
  return (await update) || Response.error();
}

async function cacheImage(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response?.ok) {
    const cache = await caches.open(IMAGE_CACHE);
    await cache.put(request, response.clone());
    await limitImageCache();
  }
  return response;
}

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin && url.pathname.includes("/images/delish/")) {
    event.respondWith(cacheImage(request));
    return;
  }

  if (request.mode === "navigate" || (url.origin === self.location.origin && url.pathname.includes("/data/"))) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});
