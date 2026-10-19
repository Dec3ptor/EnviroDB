// EnviroDB's offline copy, for field mode on a phone with no signal: the app's own files, kept as they're loaded.
// It touches nothing but the app's own address, and keeps no data – field records stay in the phone's storage.

const CACHE = 'envirodb-app';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const ours = (url) => new URL(url, self.location.href).origin === self.location.origin;

// the page lists the files it has loaded: keep them all (and only them – older versions' files go)
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'keep' || !Array.isArray(data.urls)) return;
  const urls = data.urls.filter((u) => typeof u === 'string' && ours(u)).map((u) => new URL(u, self.location.href).href);
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      await Promise.all(urls.map((u) => cache.match(u).then((hit) => hit || cache.add(u).catch(() => undefined))));
      const keep = new Set(urls);
      for (const req of await cache.keys()) if (req.url.includes('/assets/') && !keep.has(req.url)) await cache.delete(req);
    }),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || !ours(req.url)) return;
  if (req.mode === 'navigate') {
    // the page itself: the latest from the network, the kept copy when there's no signal
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(new URL('./', self.location.href).href, copy));
          }
          return res;
        })
        .catch(() => caches.match(new URL('./', self.location.href).href).then((hit) => hit || Response.error())),
    );
    return;
  }
  // the app's files never change once published (their names change instead): the kept copy first
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && new URL(req.url).pathname.includes('/assets/')) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
