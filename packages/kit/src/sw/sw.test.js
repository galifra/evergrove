import 'fake-indexeddb/auto'
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { openStore } from '@evergrove/core/store.js'
import { createLog } from '@evergrove/core/log.js'
import { createAppRegistry } from '@evergrove/rules/registry.js'
import { localDate } from '@evergrove/core/events.js'

// The service worker, exercised with a stand-in for the browser's worker scope.

const handlers = {}
const matchOptions = []
const shown = []
// A small in-memory stand-in for the browser's Cache Storage.
function makeCaches() {
  const stores = new Map()
  const keyOf = (req) => (typeof req === 'string' ? req : new URL(req.url).pathname)
  return {
    stores,
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map())
      const m = stores.get(name)
      return {
        async match(req, options) {
          matchOptions.push(options)
          const hit = m.get(keyOf(req))
          return hit ? hit.clone() : undefined
        },
        async put(req, res) {
          m.set(keyOf(req), res)
        },
        async add(req) {
          const res = await globalThis.fetch(req)
          if (!res.ok) throw new TypeError('bad response')
          m.set(keyOf(req), res)
        },
      }
    },
    async keys() {
      return [...stores.keys()]
    },
    async delete(name) {
      return stores.delete(name)
    },
  }
}

const clientsApi = { claim: vi.fn(), matchAll: vi.fn(async () => []), openWindow: vi.fn(async () => {}) }

beforeAll(async () => {
  globalThis.__PRECACHE__ = ['/', '/money/', '/moxie/', '/t/', '/assets/app-abc.js', '/missing.png']
  globalThis.self = {
    addEventListener: (type, fn) => (handlers[type] = fn),
    skipWaiting: vi.fn(),
    location: { origin: 'https://app.test' },
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
    handlers.notificationclick({ notification: closeable('/jarvis/brief'), waitUntil: (p) => (pending = p) })
    await pending
    expect(client.focus).toHaveBeenCalled()
    expect(client.navigate).toHaveBeenCalledWith('/jarvis/brief')
    expect(clientsApi.openWindow).not.toHaveBeenCalled()
  })

  it('opens a new window when the app is closed', async () => {
    let pending
    handlers.notificationclick({ notification: closeable('/jarvis/brief'), waitUntil: (p) => (pending = p) })
    await pending
    expect(clientsApi.openWindow).toHaveBeenCalledWith('/jarvis/brief')
  })
})

describe('working offline', () => {
  let online
  let network

  beforeEach(() => {
    globalThis.caches = makeCaches()
    online = true
    network = []
    globalThis.fetch = vi.fn(async (req) => {
      network.push(new URL(req.url).pathname)
      if (!online) throw new TypeError('offline')
      return new Response('body of ' + new URL(req.url).pathname, { status: 200 })
    })
  })

  const request = (path, { mode = 'cors', method = 'GET', origin = 'https://app.test' } = {}) => {
    const r = new Request(origin + path, { method })
    Object.defineProperty(r, 'mode', { value: mode })
    return r
  }

  async function ask(req) {
    let response
    let handled = false
    handlers.fetch({ request: req, respondWith: (p) => { handled = true; response = p } })
    return { handled, response: handled ? await response : undefined }
  }

  it('serves the page from cache when the network is gone, and the newest copy when it is back', async () => {
    const first = await ask(request('/', { mode: 'navigate' }))
    expect(await first.response.text()).toBe('body of /')
    online = false
    const offline = await ask(request('/', { mode: 'navigate' }))
    expect(await offline.response.text()).toBe('body of /')
    online = true
    globalThis.fetch = vi.fn(async () => new Response('newer page', { status: 200 }))
    expect(await (await ask(request('/', { mode: 'navigate' }))).response.text()).toBe('newer page')
  })

  it('opens any in-app route offline by falling back to the cached app shell', async () => {
    await ask(request('/', { mode: 'navigate' }))
    online = false
    const r = await ask(request('/some/deep/route', { mode: 'navigate' }))
    expect(await r.response.text()).toBe('body of /')
  })

  it('keeps every listed page and file ready when it installs, even if one is missing', async () => {
    globalThis.fetch = vi.fn(async (req) => new Response('page ' + new URL(req.url).pathname, { status: new URL(req.url).pathname === '/missing.png' ? 404 : 200 }))
    let pending
    handlers.install({ waitUntil: (p) => (pending = p) })
    await pending
    const kept = [...[...globalThis.caches.stores.values()][0].keys()].sort()
    expect(kept).toEqual(['/', '/assets/app-abc.js', '/money/', '/moxie/', '/t/'])
    expect(globalThis.self.skipWaiting).toHaveBeenCalled()
  })

  it('opens an app it never visited, offline, from what install kept', async () => {
    globalThis.fetch = vi.fn(async (req) => new Response('page ' + new URL(req.url).pathname, { status: 200 }))
    let pending
    handlers.install({ waitUntil: (p) => (pending = p) })
    await pending
    online = false
    globalThis.fetch = vi.fn(async () => { throw new TypeError('offline') })
    expect(await (await ask(request('/money', { mode: 'navigate' }))).response.text()).toBe('page /money/')
    expect(await (await ask(request('/t/houseplants', { mode: 'navigate' }))).response.text()).toBe('page /t/')
    expect(await (await ask(request('/not/an/app', { mode: 'navigate' }))).response.text()).toBe('page /')
  })

  it('looks files up by address alone, ignoring Vary, so files kept at install match later requests', async () => {
    await ask(request('/assets/x-1.js'))
    online = false
    matchOptions.length = 0
    await ask(request('/assets/x-1.js'))
    await ask(request('/money', { mode: 'navigate' }))
    expect(matchOptions.length).toBeGreaterThan(1)
    for (const o of matchOptions) expect(o).toEqual({ ignoreVary: true })
  })

  it('built files are served from cache without touching the network again', async () => {
    await ask(request('/assets/index-abc123.js'))
    network.length = 0
    online = false
    const r = await ask(request('/assets/index-abc123.js'))
    expect(await r.response.text()).toBe('body of /assets/index-abc123.js')
    expect(network).toEqual([])
  })

  it('never caches or intercepts the API, other sites, non-GET requests, or itself', async () => {
    expect((await ask(request('/api/usage'))).handled).toBe(false)
    expect((await ask(request('/api/sync', { method: 'POST' }))).handled).toBe(false)
    expect((await ask(request('/', { method: 'POST', mode: 'navigate' }))).handled).toBe(false)
    expect((await ask(request('/x.js', { origin: 'https://fonts.example' }))).handled).toBe(false)
    expect((await ask(request('/sw.js'))).handled).toBe(false)
    expect([...globalThis.caches.stores.values()].every((m) => m.size === 0)).toBe(true)
  })

  it('fails cleanly, not with a hang, when offline and nothing is cached yet', async () => {
    online = false
    const r = await ask(request('/', { mode: 'navigate' }))
    expect(r.response.type).toBe('error')
  })

  it("a new version clears the old version's cache when it activates", async () => {
    await globalThis.caches.open('evergrove-shell-old-build')
    await globalThis.caches.open('some-other-app-cache')
    let pending
    handlers.activate({ waitUntil: (p) => (pending = p) })
    await pending
    const names = await globalThis.caches.keys()
    expect(names).not.toContain('evergrove-shell-old-build')
    expect(names).toContain('some-other-app-cache')
    expect(clientsApi.claim).toHaveBeenCalled()
  })
})
