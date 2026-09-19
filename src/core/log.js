import { validateEvent } from './events'

// The shared log: a validated, deduplicating, observable view over the store.
// Every module and Evergrove read from `getEvents()` and write via `append`.
export function createLog(store, { channelName = 'evergrove-log' } = {}) {
  let events = []
  const listeners = new Set()
  let channel = null

  function emit() {
    for (const fn of listeners) fn()
  }

  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(channelName)
    channel.onmessage = (msg) => {
      const incoming = msg.data
      if (!Array.isArray(incoming)) return
      const known = new Set(events.map((e) => e.id))
      const fresh = incoming.filter((e) => !validateEvent(e) && !known.has(e.id))
      if (fresh.length) {
        events = [...events, ...fresh]
        emit()
      }
    }
  }

  return {
    async load() {
      events = await store.all()
      emit()
      return events
    },

    getEvents() {
      return events
    },

    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },

    // Validates then appends. Invalid events are rejected loudly rather than
    // stored, because a corrupt event would poison every rebuild.
    async append(input, { broadcast = true } = {}) {
      const list = Array.isArray(input) ? input : [input]
      for (const e of list) {
        const problem = validateEvent(e)
        if (problem) throw new Error(`Invalid event (${e?.type ?? '?'}): ${problem}`)
      }
      const added = await store.appendMany(list)
      if (added.length) {
        events = [...events, ...added]
        emit()
        if (broadcast && channel) channel.postMessage(added)
      }
      return added
    },

    async reset() {
      await store.clearAll()
      events = []
      emit()
    },

    close() {
      channel?.close()
      listeners.clear()
    },

    store,
  }
}
