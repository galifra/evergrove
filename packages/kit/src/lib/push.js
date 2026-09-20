import { getAccessCode } from '@evergrove/core/lib/storage.js'

// Public VAPID key — safe to expose client-side (that's how Web Push works;
// only the matching private key on the server can actually send pushes).
const VAPID_PUBLIC_KEY = 'BNuvPFSlWmefNRwmK-mJnZ9SIAVkxbfRmMGbfWcL7mys9lfcvPFL9xLqSEDvQcKXfYyFLBgb2H69kxWUnhrwvi8'

export function pushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)))
}

export async function enablePushReminders(reminderTime) {
  if (!pushSupported()) throw new Error('Push notifications are not supported in this browser.')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notification permission was not granted.')

  const registration = await navigator.serviceWorker.register('/sw.js')
  await navigator.serviceWorker.ready

  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    })
  }

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

  const res = await fetch('/api/save-subscription', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-app-code': getAccessCode() },
    body: JSON.stringify({ subscription, reminderTime, timezone }),
  })
  if (res.status === 401) throw new Error('Access code missing or wrong. Enter it in Settings first.')
  if (!res.ok) throw new Error('Could not save your subscription to the server.')

  return subscription
}

export async function disablePushReminders() {
  if (!pushSupported()) return
  const registration = await navigator.serviceWorker.getRegistration('/sw.js')
  const subscription = await registration?.pushManager.getSubscription()
  if (subscription) {
    await fetch('/api/save-subscription', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'x-app-code': getAccessCode() },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    }).catch(() => {})
    await subscription.unsubscribe()
  }
}


// Shows what tonight's notification will look like, right now, so it can be
// checked without waiting for the evening. Uses the same text the real one uses.
export async function showBriefingPreview(brief) {
  if (typeof Notification === 'undefined') throw new Error('This browser cannot show notifications.')
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notification permission was not granted.')
  const options = { body: brief.body, icon: '/icon-192.png', tag: 'evergrove-preview', data: { url: '/jarvis/brief' } }
  const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration('/sw.js') : null
  if (registration) await registration.showNotification(brief.title, options)
  else new Notification(brief.title, options)
}
