const CACHE_NAME = 'barberia-pwa-v98';
const APP_SHELL = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest', './icon.svg', './alerta-25.mp3', './alerta-21.mp3', './terminos-y-condiciones-barberlink.pdf'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch {
    payload = { body: event.data?.text() || 'Hay una novedad sobre tu cita.' };
  }
  event.waitUntil(Promise.all([
    self.registration.showNotification(payload.title || 'Aviso de tu barbería', {
      body: payload.body || 'Hay una novedad sobre tu cita.',
      icon: './icon.svg',
      badge: './icon.svg',
      data: { url: payload.url || './' }
    }),
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const target = windows.find((client) => client.focused) || windows[0];
      target?.postMessage({ type: 'BARBERLINK_PUSH_RECEIVED' });
    })
  ]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './', self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((client) => new URL(client.url).origin === target.origin);
    if (existing) {
      existing.navigate(target.href);
      return existing.focus();
    }
    return clients.openWindow(target.href);
  }));
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        throw new Error('No hay conexión y este recurso no está guardado.');
      })
  );
});
