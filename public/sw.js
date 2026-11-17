/* Seek's service worker: shows notifications sent while Seek isn't open (Web Push), and opens the right
   conversation when one is clicked. Nothing is cached here; the app always loads fresh. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

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
