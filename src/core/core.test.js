import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { createEvent, effectiveEvents, sortEvents, validateEvent } from './events'
import { openStore } from './store'
import { createLog } from './log'

let n = 0
function ev(over = {}) {
  n += 1
  return createEvent({ type: 'skill.practiced', app: 'evergrove', area: 'health', data: { xp: 5 }, id: `e${n}`, ...over })
}

describe('event validation', () => {
  it('accepts a well-formed event', () => {
    expect(validateEvent(ev())).toBeNull()
  })
  it('rejects bad type, area, timestamps and oversized data', () => {
    expect(validateEvent({ ...ev(), type: 'NoDot' })).toMatch(/type/)
    expect(validateEvent({ ...ev(), area: 'nope' })).toMatch(/area/)
    expect(validateEvent({ ...ev(), occurredAt: 'yesterday-ish' })).toMatch(/occurredAt/)
    expect(validateEvent({ ...ev(), data: { blob: 'x'.repeat(9000) } })).toMatch(/large/)
    expect(validateEvent({ ...ev(), data: [] })).toMatch(/object/)
  })
  it('allows area to be null for system events', () => {
    expect(validateEvent(ev({ area: null }))).toBeNull()
  })
})

describe('corrections', () => {
  it('reversal cancels an event', () => {
    const a = ev()
    const r = ev({ type: 'event.reversed', supersedes: a.id })
    expect(effectiveEvents([a, r]).map((e) => e.id)).toEqual([])
  })
  it('reversing a reversal restores the original', () => {
    const a = ev()
    const r = ev({ type: 'event.reversed', supersedes: a.id })
    const rr = ev({ type: 'event.reversed', supersedes: r.id })
    expect(effectiveEvents([a, r, rr]).map((e) => e.id)).toEqual([a.id])
  })
  it('cancel-and-replace keeps only the replacement', () => {
    const a = ev()
    const b = ev({ supersedes: a.id, data: { xp: 9 } })
    expect(effectiveEvents([a, b]).map((e) => e.id)).toEqual([b.id])
  })
  it('a reversal that arrives before its target still applies', () => {
    const a = ev()
    const r = ev({ type: 'event.reversed', supersedes: a.id })
    expect(effectiveEvents([r]).length).toBe(0)
    expect(effectiveEvents([r, a]).length).toBe(0)
  })
})

describe('ordering', () => {
  it('sorts by occurredAt regardless of arrival order (late events)', () => {
    const early = ev({ occurredAt: '2026-01-01T10:00:00.000Z', now: new Date('2026-01-05T00:00:00Z') })
    const late = ev({ occurredAt: '2026-01-03T10:00:00.000Z', now: new Date('2026-01-03T10:00:00Z') })
    expect(sortEvents([late, early]).map((e) => e.id)).toEqual([early.id, late.id])
    expect(sortEvents([early, late]).map((e) => e.id)).toEqual([early.id, late.id])
  })
})

describe('store and log', () => {
  let store
  let log
  beforeEach(async () => {
    store = await openStore(`t-${Math.random()}`)
    log = createLog(store, { channelName: `c-${Math.random()}` })
  })

  it('is idempotent: appending the same id twice stores one', async () => {
    const a = ev()
    expect((await log.append(a)).length).toBe(1)
    expect((await log.append(a)).length).toBe(0)
    expect(await store.count()).toBe(1)
    expect(log.getEvents().length).toBe(1)
  })

  it('dedupes within one batch', async () => {
    const a = ev()
    await log.append([a, a])
    expect(await store.count()).toBe(1)
  })

  it('rejects invalid events without storing anything', async () => {
    await expect(log.append({ ...ev(), type: 'bad' })).rejects.toThrow(/Invalid event/)
    expect(await store.count()).toBe(0)
  })

  it('exposes no update/delete API on the store', () => {
    expect(store.update).toBeUndefined()
    expect(store.delete).toBeUndefined()
    expect(store.remove).toBeUndefined()
  })

  it('survives reload: a new log over the same store sees everything', async () => {
    await log.append([ev(), ev()])
    const again = createLog(store, { channelName: `c2-${Math.random()}` })
    await again.load()
    expect(again.getEvents().length).toBe(2)
  })

  it('tracks pushed state for sync', async () => {
    const [a, b] = [ev(), ev()]
    await log.append([a, b])
    await store.markPushed([a.id])
    expect((await store.unpushed()).map((e) => e.id)).toEqual([b.id])
  })

  it('reset clears everything', async () => {
    await log.append(ev())
    await log.reset()
    expect(await store.count()).toBe(0)
    expect(log.getEvents()).toEqual([])
  })
})
