import 'fake-indexeddb/auto'
import { describe, it, expect } from 'vitest'
import { createEvent } from './events'
import { openStore } from './store'
import { createLog } from './log'
import { createSync } from './sync'
import syncHandler from '../../../api/sync.js'
import { getKv } from '../../../server/store.js'

delete process.env.APP_ACCESS_CODE

function call(method, { url = '/api/sync', body } = {}) {
  return new Promise((resolve) => {
    const res = {
      code: 200,
      status(c) {
        this.code = c
        return this
      },
      json(obj) {
        resolve({ code: this.code, body: obj })
      },
    }
    syncHandler({ method, url, headers: {}, body }, res)
  })
}

const relay = {
  async push(vaultId, items) {
    const r = await call('POST', { body: { vaultId, items } })
    if (r.code !== 200) throw new Error(`push ${r.code}`)
  },
  async pull(vaultId, after) {
    const r = await call('GET', { url: `/api/sync?vaultId=${vaultId}&after=${after}` })
    if (r.code !== 200) throw new Error(`pull ${r.code}`)
    return r.body
  },
}

async function device(passphrase) {
  const store = await openStore(`dev-${Math.random()}`)
  const log = createLog(store, { channelName: `ch-${Math.random()}` })
  const sync = createSync({ log, transport: relay, iterations: 1000 })
  await sync.configure(passphrase)
  return { store, log, sync }
}

let n = 0
const mk = (extra = {}) =>
  createEvent({ id: `s${Date.now()}-${n++}`, type: 'skill.practiced', app: 'evergrove', area: 'health', data: { xp: 5, secret: 'my private note' }, ...extra })

const ids = (d) => d.log.getEvents().map((e) => e.id).sort()

describe('encrypted multi-device sync', () => {
  it('moves events between two devices in both directions', async () => {
    const pass = `pass-${Math.random()}`
    const a = await device(pass)
    const b = await device(pass)
    await a.log.append([mk(), mk()])
    await a.sync.syncNow()
    const r = await b.sync.syncNow()
    expect(r.pulled).toBe(2)
    await b.log.append(mk())
    await b.sync.syncNow()
    await a.sync.syncNow()
    expect(ids(a)).toEqual(ids(b))
    expect(ids(a).length).toBe(3)
  })

  it('merges two devices that both wrote while offline, with no loss or duplicates', async () => {
    const pass = `pass-${Math.random()}`
    const a = await device(pass)
    const b = await device(pass)
    await a.log.append([mk(), mk()])
    await b.log.append([mk(), mk(), mk()])
    await a.sync.syncNow()
    await b.sync.syncNow()
    await a.sync.syncNow()
    await b.sync.syncNow()
    expect(ids(a)).toEqual(ids(b))
    expect(ids(a).length).toBe(5)
    await a.sync.syncNow()
    expect(ids(a).length).toBe(5)
  })

  it('the relay never holds plaintext', async () => {
    const pass = `pass-${Math.random()}`
    const a = await device(pass)
    await a.log.append(mk())
    await a.sync.syncNow()
    const stored = JSON.stringify(await getKv().lrange(`evergrove:log:${await a.sync.configure(pass)}`, 0, -1))
    expect(stored).not.toContain('my private note')
    expect(stored).not.toContain('skill.practiced')
  })

  it('a wrong passphrase writes nothing and does not lose its place', async () => {
    const pass = `pass-${Math.random()}`
    const a = await device(pass)
    await a.log.append(mk())
    await a.sync.syncNow()

    // same vault requires same key, so simulate a wrong key reading the right vault
    const wrong = await device('some other passphrase')
    const vaultOfA = await a.sync.configure(pass)
    const items = (await relay.pull(vaultOfA, 0)).items
    expect(items.length).toBe(1)
    const badTransport = { push: relay.push, pull: async () => ({ items, next: items.length }) }
    const badSync = createSync({ log: wrong.log, transport: badTransport, iterations: 1000 })
    await badSync.configure('some other passphrase')
    await expect(badSync.syncNow()).rejects.toThrow(/passphrase/)
    expect(wrong.log.getEvents().length).toBe(0)
    expect(await wrong.store.getMeta('syncCursor')).toBeUndefined()
  })

  it('different passphrases never share a vault', async () => {
    const a = await device(`one-${Math.random()}`)
    const b = await device(`two-${Math.random()}`)
    await a.log.append(mk())
    await a.sync.syncNow()
    const r = await b.sync.syncNow()
    expect(r.pulled).toBe(0)
  })

  it('pushing the same events twice does not duplicate them on the relay', async () => {
    const pass = `pass-${Math.random()}`
    const a = await device(pass)
    const e = mk()
    await a.log.append(e)
    await a.sync.syncNow()
    await a.store.setMeta('syncCursor', 0)
    const vault = await a.sync.configure(pass)
    await relay.push(vault, [{ id: e.id, iv: 'x', ct: 'y' }])
    const r = await relay.pull(vault, 0)
    expect(r.items.length).toBe(1)
  })

  it('does nothing when sync is off', async () => {
    const d = await device('')
    expect((await d.sync.syncNow()).skipped).toBeTruthy()
  })
})
