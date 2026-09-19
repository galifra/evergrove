import { getKv } from './store.js'

// Single-user app, several devices. One record holds every device's push
// subscription (keyed by its endpoint) plus the one fact the reminder job needs
// that lives nowhere else: when something was last logged. The cron runs
// server-side with no access to the browser's data.
const KEY = 'evergrove:reminder'

// Older records held a single subscription at the top level; fold it into the
// device map so nothing already saved is lost.
export function normalize(raw) {
  const state = raw && typeof raw === 'object' ? { ...raw } : {}
  const devices = { ...(state.devices ?? {}) }
  if (state.subscription?.endpoint && !devices[state.subscription.endpoint]) {
    devices[state.subscription.endpoint] = {
      subscription: state.subscription,
      reminderTime: state.reminderTime ?? '21:00',
      lastNotifiedDate: state.lastNotifiedDate ?? null,
    }
  }
  return {
    devices,
    timezone: state.timezone ?? 'UTC',
    lastEntryDate: state.lastEntryDate ?? null,
  }
}

export async function loadReminderState() {
  return normalize(await getKv().get(KEY))
}

async function save(state) {
  await getKv().set(KEY, state)
  return state
}

export async function saveDevice({ subscription, reminderTime, timezone }) {
  const state = await loadReminderState()
  const prev = state.devices[subscription.endpoint]
  state.devices[subscription.endpoint] = { subscription, reminderTime, lastNotifiedDate: prev?.lastNotifiedDate ?? null }
  state.timezone = timezone
  return save(state)
}

export async function removeDevice(endpoint) {
  const state = await loadReminderState()
  delete state.devices[endpoint]
  return save(state)
}

export async function patchDevice(endpoint, patch) {
  const state = await loadReminderState()
  if (state.devices[endpoint]) state.devices[endpoint] = { ...state.devices[endpoint], ...patch }
  return save(state)
}

