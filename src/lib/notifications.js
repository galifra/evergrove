// Best-effort end-of-day reminder. Fires a browser Notification once per day
// at the user's chosen time, as long as this tab (or an installed copy of
// the app) is open — browsers don't allow true background alerts for a
// plain web app without a push server, so this checks on an interval while
// the app is running rather than promising a wake-up when it's fully closed.

export function notificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window
}

export async function requestNotificationPermission() {
  if (!notificationsSupported()) return 'unsupported'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  return Notification.requestPermission()
}

function todayKey() {
  return new Date().toDateString()
}

function timeHasPassed(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  const target = new Date()
  target.setHours(h, m, 0, 0)
  return new Date() >= target
}

export function maybeFireReminder(state, onFired) {
  const { settings, entries } = state
  if (!settings.reminderEnabled) return
  if (!notificationsSupported() || Notification.permission !== 'granted') return
  if (settings.lastReminderDate === todayKey()) return
  if (!timeHasPassed(settings.reminderTime)) return

  const loggedToday = entries.some((e) => new Date(e.createdAt).toDateString() === todayKey())
  if (loggedToday) {
    onFired(todayKey(), { skipped: true })
    return
  }

  try {
    new Notification('Evergrove', {
      body: "Haven't heard from you today — what did you get done?",
      icon: '/tree-icon.svg',
      tag: 'evergrove-daily',
    })
  } catch {
    // Notification constructor can throw in some contexts (e.g. service worker
    // required on mobile) — fail silently, the in-app buddy still shows the nudge.
  }
  onFired(todayKey(), { skipped: false })
}
