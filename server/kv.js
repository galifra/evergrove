import { getKv } from './store.js'

// Single-user app — one fixed record holds the push subscription and the
// bits of state the reminder cron needs (it runs server-side with no
// access to the browser's data, which is where everything else lives).
const KEY = 'evergrove:reminder'

export function loadReminderState() {
  return getKv().get(KEY)
}

export async function mergeReminderState(patch) {
  const kv = getKv()
  const current = (await kv.get(KEY)) || {}
  const next = { ...current, ...patch }
  await kv.set(KEY, next)
  return next
}

export async function clearReminderState() {
  await getKv().del(KEY)
}
