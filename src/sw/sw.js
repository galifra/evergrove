// Service worker: wakes for a push, even with the app closed, and builds the
// notification text ON THIS DEVICE from this device's own data. The server only
// ever sends a content-free "it's time" ping, so nothing about your calendar,
// tasks or bills leaves your device to make a notification.
import { composeBriefing } from '../evergrove/briefing'

const DB_NAME = 'evergrove-log'
// Stamped in at build time so every deploy gets a fresh cache and old ones are dropped.
const BUILD = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'
const CACHE = `evergrove-shell-${BUILD}`
const FALLBACK = { title: 'Evergrove', body: 'Your briefing for tomorrow is ready. Open Evergrove to see it.' }

// Open the app's existing database without ever creating it: a brand-new empty
// database here would break the app's own first-run setup.
function openExisting() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME)
    req.onupgradeneeded = () => req.transaction.abort()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function readStore(db, name, key) {
  return new Promise((resolve, reject) => {
    const store = db.transaction(name).objectStore(name)
    const req = key === undefined ? store.getAll() : store.get(key)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function buildNotification(payload) {
  const base = { ...FALLBACK }
  if (payload.title) base.title = payload.title
  if (payload.body) base.body = payload.body
  if (payload.type !== 'daily') return base

  let db
  try {
    db = await openExisting()
    const events = await readStore(db, 'events')
    const prefsRow = await readStore(db, 'meta', 'briefingPrefs')
    if (!events.length) return base
    const brief = composeBriefing(events, new Date(), prefsRow?.value)
    return { title: brief.title, body: brief.body }
  } catch {
    return base
  } finally {
    db?.close()
  }
}

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((n) => n.startsWith('evergrove-shell-') && n !== CACHE).map((n) => caches.delete(n)))
      await self.clients.claim()
    })()
  )
})

// Offline: the app is just files plus a local database, so once it has been
// opened online it can open with no connection. Pages go network-first (you always
// get the newest version when online, the last one when not). Built files have
// content-hashed names, so they are safe to serve straight from the cache.
// Nothing under /api/ is ever cached: sync, the AI and reminders are online-only.
async function networkFirst(request) {
  const cache = await caches.open(CACHE)
  try {
    const fresh = await fetch(request)
    if (fresh.ok) cache.put(request, fresh.clone())
    return fresh
  } catch {
    const hit = (await cache.match(request)) ?? (request.mode === 'navigate' ? await cache.match('/') : undefined)
    return hit ?? Response.error()
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(request)
  if (hit) return hit
  const fresh = await fetch(request)
  if (fresh.ok) cache.put(request, fresh.clone())
  return fresh
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname === '/sw.js') return
  if (request.mode === 'navigate') event.respondWith(networkFirst(request))
  else if (url.pathname.startsWith('/assets/')) event.respondWith(cacheFirst(request))
  else if (/\.(png|svg|json|ico)$/.test(url.pathname)) event.respondWith(networkFirst(request))
})

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    if (event.data) payload = event.data.json()
  } catch {
    // malformed payload: fall back to the default message
  }
  event.waitUntil(
    buildNotification(payload).then(({ title, body }) =>
      self.registration.showNotification(title, {
        body,
        icon: '/icon-192.png',
        badge: '/tree-icon.svg',
        tag: 'evergrove-daily',
        data: { url: '/#/jarvis/brief' },
      })
    )
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url ?? '/#/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          await client.focus()
          if ('navigate' in client) await client.navigate(url).catch(() => {})
          return
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(url)
    })
  )
})
