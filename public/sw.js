const CACHE_NAME = 'ezz-ride-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);
      return cached || networkFetch;
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification && event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        try {
          if (client.url === url && 'focus' in client) return client.focus();
        } catch (e) {
          // ignore
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

self.addEventListener('push', (event) => {
  let payload = { title: 'كابتن عز 🚖', body: 'يوجد طلب مشوار جديد!' };
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload.body = event.data.text();
    }
  }
  payload.data = payload.data || {};
  payload.data.url = payload.data.url || payload.url || '/?playNotification=1';
  const options = {
    body: payload.body,
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: payload.data.tag || 'ezz-ride-notification',
    requireInteraction: true,
    vibrate: payload.data.vibrate || [500, 200, 500, 200, 500],
    data: payload.data,
  };
  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'SHOW_BACKGROUND_NOTIFICATION') {
    const { title, body, icon, tag, vibrate, url } = event.data;
    const options = {
      body,
      icon: icon || '/icon.svg',
      badge: '/icon.svg',
      tag: tag || title,
      requireInteraction: true,
      vibrate: vibrate || [500, 200, 500, 200, 500],
      data: { url: url || '/?playNotification=1' },
    };
    event.waitUntil(self.registration.showNotification(title, options));
  }
});
