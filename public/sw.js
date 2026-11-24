/* Seek's service worker: shows notifications sent while Seek isn't open (Web Push), and opens the right
   conversation when one is clicked. It also keeps the app's build files (/_next/static/*, named by their content
   so they never change) and fonts on this device, so Seek starts without downloading them again. Pages, data and
   anything from Supabase are never cached: they always come fresh from the network. */

// bump to drop what older versions kept
const CACHE = 'seek-static-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) =>
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  ),
);

/** Build files and fonts from Seek's own address (content-hashed, so a cached copy is always right). */
function cacheable(req) {
  if (req.method !== 'GET') return false;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return false;
  return url.pathname.startsWith('/_next/static/') || /\.(woff2?|ttf|otf)$/i.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (!cacheable(req)) return; // everything else goes to the network as usual
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
      return res;
    })(),
  );
});

self.addEventListener('push', (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch (_) {
    d = { title: 'Seek', body: event.data ? event.data.text() : '' };
  }
  const title = d.title || 'Seek';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: d.body || 'New message',
      icon: '/icon.png',
      badge: '/icon.png',
      tag: d.tag || undefined,
      renotify: !!d.tag,
      data: { url: d.url || '/channels' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/channels', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // reuse an open Seek tab when there is one
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin && 'focus' in w) {
          await w.focus();
          if ('navigate' in w) return w.navigate(url);
          return;
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
