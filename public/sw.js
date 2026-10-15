// Service worker: cache-first with background refresh (v1 pattern).
// Own origin mgtthrdt-fokus.github.io; the "fokus-" prefix still keeps other caches safe if that ever changes,
// so only touch caches with the "fokus-" prefix. GitHub API calls never go through the cache.
const PREFIX = "fokus-";
const CACHE = PREFIX + (new URL(location.href).searchParams.get("v") || "dev");
const SCOPE = new URL(self.registration.scope);
const DOC = new URL("index.html", SCOPE).href;
const ASSETS = ["index.html", "manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png"].map(u => new URL(u, SCOPE).href);

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;
  if (url.pathname.endsWith("/version.json")) return;   // always fresh; vault.json is cached so a remembered key works offline
  const isDoc = url.pathname === SCOPE.pathname || url.pathname === SCOPE.pathname + "index.html";
  const key = isDoc ? DOC : url.origin + url.pathname;
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(key);
    const net = fetch(isDoc ? new Request(DOC, { cache: "no-cache" }) : req).then(res => {
      if (res && res.ok && res.type === "basic" && !res.redirected) c.put(key, res.clone()).catch(() => {});
      return res;
    });
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    return net;
  }));
});
