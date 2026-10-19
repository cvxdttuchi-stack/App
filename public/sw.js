// Offline shell cache: app ka dhancha phone me save rehta hai, API hamesha live jati hai.
const V = "veda-ai-v2_2";
// v1.3 fix: vpdf.js (advanced PDF creation) precache me missing tha — offline me doc preview toot jata.
const SHELL = ["./", "index.html", "style.css", "themes.css", "app.js", "tools.js", "pdfedit.js", "md.js", "vpdf.js", "pdf-lib.min.js", "pdf.min.js", "pdf.worker.min.js", "manifest.json", "logo.svg", "icons.svg", "icon-192.png", "icon-512.png", "fonts/noto-dev-2.woff2"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.pathname.startsWith("/api/")) return;
  // network-first: naya code turant mile, net na ho to cache
  e.respondWith(
    fetch(e.request).then((r) => {
      const copy = r.clone();
      caches.open(V).then((c) => c.put(e.request, copy)).catch(() => {});
      return r;
    }).catch(() => caches.match(e.request).then((m) => m || caches.match("index.html")))
  );
});
