// Minimal service worker whose only job is to receive push events and show
// a notification, even when no tab is open. No offline caching here —
// deliberately, to avoid ever serving a stale build after a deploy.

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let data = { title: 'Evergrove', body: "Haven't heard from you today." }
  try {
    if (event.data) data = { ...data, ...event.data.json() }
  } catch {
    // ignore malformed payloads, fall back to defaults
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/tree-icon.svg',
      badge: '/tree-icon.svg',
      tag: 'evergrove-daily',
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow('/')
    })
  )
})
