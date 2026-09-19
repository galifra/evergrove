import { getAccessCode } from './storage'

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

// Called after every successful entry so the reminder cron knows not to nag.
export function pingLoggedToday() {
  fetch('/api/mark-logged', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-app-code': getAccessCode() },
  }).catch(() => {})
}
