import 'fake-indexeddb/auto'
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { openStore } from '../core/store'
import { createLog } from '../core/log'
import { createAppRegistry } from '../modules'
import { localDate } from '../core/events'

// The service worker, exercised with a stand-in for the browser's worker scope.

const handlers = {}
const shown = []
const clientsApi = { claim: vi.fn(), matchAll: vi.fn(async () => []), openWindow: vi.fn(async () => {}) }

beforeAll(async () => {
  globalThis.self = {
    addEventListener: (type, fn) => (handlers[type] = fn),
    skipWaiting: vi.fn(),
    clients: clientsApi,
    registration: { showNotification: vi.fn(async (title, options) => shown.push({ title, options })) },
  }
  await import('./sw.js')
})

beforeEach(() => {
  shown.length = 0
  clientsApi.matchAll.mockClear()
  clientsApi.openWindow.mockClear()
})

async function push(payload) {
  let pending
  await handlers.push({
    data: payload === undefined ? null : { json: () => (payload instanceof Error ? (() => { throw payload })() : payload) },
    waitUntil: (p) => (pending = p),
  })
  await pending
}

const tomorrow = () => {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return localDate(d)
}

async function seedApp({ prefs } = {}) {
  const store = await openStore('evergrove-log')
  await store.clearAll()
  const log = createLog(store, { channelName: `sw-${Math.random()}` })
  const reg = createAppRegistry(log)
  await reg.invoke('calendar__add_event', { title: 'Help Theo move', start: `${tomorrow()}T09:30` }, { actor: 'user', approved: true })
  await reg.invoke('tasks__add_task', { title: 'Renew license', due: tomorrow() }, { actor: 'user', approved: true })
  if (prefs) await store.setMeta('briefingPrefs', prefs)
  store.close()
}

describe('the push handler', () => {
  it("builds tomorrow's briefing from this device's own data", async () => {
    await seedApp()
    await push({ type: 'daily', title: 'Evergrove', body: 'generic fallback' })
    expect(shown).toHaveLength(1)
    expect(shown[0].title).toMatch(/^Tomorrow · /)
    expect(shown[0].options.body).toMatch(/9:30 AM Help Theo move/)
    expect(shown[0].options.body).toMatch(/Due: Renew license/)
    expect(shown[0].options.tag).toBe('evergrove-daily')
  })

  it('honors the counts-only privacy setting stored on the device', async () => {
    await seedApp({ prefs: { detail: 'counts', showAmounts: false } })
    await push({ type: 'daily' })
    expect(shown[0].options.body).toMatch(/1 event, 1 task due/)
    expect(shown[0].options.body).not.toMatch(/Theo|license/)
  })

  it('falls back to the plain message when the app has no data on this device yet', async () => {
    const store = await openStore('evergrove-log')
    await store.clearAll()
    store.close()
    await push({ type: 'daily', body: 'Your briefing is ready.' })
    expect(shown[0]).toMatchObject({ title: 'Evergrove' })
    expect(shown[0].options.body).toBe('Your briefing is ready.')
  })

  it('shows older-style pushes exactly as sent', async () => {
    await push({ title: 'Evergrove', body: "Haven't heard from you today." })
    expect(shown[0].options.body).toBe("Haven't heard from you today.")
  })

  it('survives a missing or malformed payload', async () => {
    await push(undefined)
    await push(new Error('bad json'))
    expect(shown).toHaveLength(2)
    expect(shown[1].title).toBe('Evergrove')
  })
})

describe('tapping the notification', () => {
  const closeable = (url) => ({ close: vi.fn(), data: { url } })

  it('focuses an open window and sends it to the briefing', async () => {
    const client = { focus: vi.fn(async () => {}), navigate: vi.fn(async () => {}) }
    clientsApi.matchAll.mockResolvedValueOnce([client])
    let pending
    handlers.notificationclick({ notification: closeable('/#/jarvis/brief'), waitUntil: (p) => (pending = p) })
    await pending
    expect(client.focus).toHaveBeenCalled()
    expect(client.navigate).toHaveBeenCalledWith('/#/jarvis/brief')
    expect(clientsApi.openWindow).not.toHaveBeenCalled()
  })

  it('opens a new window when the app is closed', async () => {
    let pending
    handlers.notificationclick({ notification: closeable('/#/jarvis/brief'), waitUntil: (p) => (pending = p) })
    await pending
    expect(clientsApi.openWindow).toHaveBeenCalledWith('/#/jarvis/brief')
  })
})
