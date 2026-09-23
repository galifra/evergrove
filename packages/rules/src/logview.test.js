import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { openStore } from '@evergrove/core/store.js'
import { createLog } from '@evergrove/core/log.js'
import { createEvent, setDeviceId, validateEvent } from '@evergrove/core/events.js'
import { createAppRegistry } from './registry.js'
import { analyzeCorrections, buildViewContext, csvCell, deviceLabel, exportCsv, exportJson, filterChoices, filterEvents, growthLines, isPrivate, logStats, summarize } from './logview.js'

// The log viewer's logic (T-P3): filters and search return exactly the right
// events, corrections are shown not hidden, private contents stay masked, exports round-trip.

const NOW = new Date(2026, 4, 15, 12)
let log
let reg
let seq = 0
beforeEach(async () => {
  log = createLog(await openStore(`lv-${Math.random()}`), { channelName: `lvc-${Math.random()}` })
  reg = createAppRegistry(log)
})

const ev = (type, app, data, over = {}) =>
  createEvent({ id: `l${seq++}`, type, app, area: over.area ?? null, occurredAt: over.at ?? '2026-05-10T12:00:00.000Z', actor: over.actor ?? 'user', data, ...over })
const add = (...events) => log.append(events)
const ctx = () => buildViewContext(log.getEvents())
const list = (filters) => filterEvents(log.getEvents(), filters, ctx())

async function seed() {
  await add(
    ev('tracker.entry', 'body', { trackerId: 'body', values: { kind: 'Running', minutes: 30 } }, { area: 'health', at: '2026-05-01T09:00:00.000Z' }),
    ev('tracker.entry', 'health', { trackerId: 'health', values: { kind: 'weight', value: 171.5, notes: 'SECRETNOTE' } }, { area: 'health', at: '2026-05-02T09:00:00.000Z' }),
    ev('money.purchase.logged', 'money', { purchaseId: 'p1', amountCents: 1250, category: 'groceries', merchant: 'Kroger', date: '2026-05-03' }, { area: 'discipline', at: '2026-05-03T09:00:00.000Z' }),
    ev('task.created', 'tasks', { taskId: 't1', title: 'Buy milk' }, { area: 'discipline', at: '2026-05-04T09:00:00.000Z' }),
    ev('task.created', 'tasks', { taskId: 't2', title: 'Call mom' }, { area: 'social', actor: 'jarvis', at: '2026-05-05T09:00:00.000Z' }),
    ev('skill.practiced', 'evergrove', { domain: 'craft', skillId: 'guitar', skillName: 'Guitar', xp: 8 }, { area: 'craft', at: '2026-05-06T09:00:00.000Z' })
  )
}

describe('summaries', () => {
  it('describes each kind of event in plain words', async () => {
    await seed()
    const c = ctx()
    const byType = (t, app) => log.getEvents().find((e) => e.type === t && (!app || e.app === app))
    expect(summarize(byType('tracker.entry', 'body'), c)).toBe('Body: Running, 30')
    expect(summarize(byType('task.created'), c)).toBe('Task: Buy milk')
    expect(summarize(byType('skill.practiced'), c)).toBe('Practiced Guitar (+8 xp)')
  })

  it('shows a private event only as "<App> entry (private)" unless private contents are allowed', async () => {
    await seed()
    const c = ctx()
    const purchase = log.getEvents().find((e) => e.type === 'money.purchase.logged')
    const weight = log.getEvents().find((e) => e.app === 'health')
    expect(summarize(purchase, c)).toBe('Money entry (private)')
    expect(summarize(weight, c)).toBe('Health & diet entry (private)')
    expect(summarize(purchase, c, { showPrivate: true })).toBe('$12.50 groceries at Kroger')
    expect(summarize(weight, c, { showPrivate: true })).toContain('SECRETNOTE')
  })

  it('never shows vault contents, only the title', async () => {
    await add(ev('vault.item.saved', 'vault', { itemId: 'v1', title: 'Passport', kind: 'identity', iv: 'x', ct: 'CIPHERTEXT' }))
    const e = log.getEvents()[0]
    expect(summarize(e, ctx(), { showPrivate: true })).toBe('Saved "Passport" (contents stay encrypted)')
    expect(summarize(e, ctx(), { showPrivate: true })).not.toContain('CIPHERTEXT')
  })

  it('treats a command that ran on a private app as private, and falls back for unknown types', async () => {
    await reg.invoke('money__log_purchase', { amount: 20, category: 'dining' }, { now: NOW })
    const cmd = log.getEvents().find((e) => e.type === 'command.executed')
    expect(isPrivate(cmd, ctx())).toBe(true)
    expect(summarize(cmd, ctx())).toBe('MOXIE entry (private)')
    await add(ev('something.new', 'mystery', {}))
    expect(summarize(log.getEvents().find((e) => e.type === 'something.new'), ctx())).toBe('something.new')
  })

  it('knows which apps are private, including a private custom tracker', async () => {
    await add(ev('tracker.defined', 'panic-log', { trackerId: 'panic-log', name: 'Panic log', area: 'inner', fields: [{ label: 'What', type: 'text', required: true }], sensitive: true }, { area: 'inner' }))
    const c = ctx()
    for (const id of ['money', 'people', 'vault', 'health', 'mind', 'compass', 'panic-log']) expect(c.priv.has(id), id).toBe(true)
    for (const id of ['tasks', 'calendar', 'body', 'learning']) expect(c.priv.has(id), id).toBe(false)
  })
})

describe('filters and search return exactly the right events', () => {
  beforeEach(seed)

  it('filters by app, type, area and who acted', () => {
    expect(list({ apps: ['tasks'] })).toHaveLength(2)
    expect(list({ types: ['task.created'] })).toHaveLength(2)
    expect(list({ areas: ['health'] })).toHaveLength(2)
    expect(list({ actors: ['jarvis'] }).map((e) => e.data.title)).toEqual(['Call mom'])
    expect(list({ apps: ['tasks'], actors: ['user'] }).map((e) => e.data.title)).toEqual(['Buy milk'])
    expect(list({ apps: ['nothing'] })).toEqual([])
  })

  it('filters by date range, inclusive at both ends', () => {
    const days = (f) => list(f).map((e) => e.occurredAt.slice(0, 10)).sort()
    expect(days({ from: '2026-05-03', to: '2026-05-05' })).toEqual(['2026-05-03', '2026-05-04', '2026-05-05'])
    expect(days({ from: '2026-05-06' })).toEqual(['2026-05-06'])
    expect(days({ to: '2026-05-01' })).toEqual(['2026-05-01'])
    expect(days({ from: '2026-06-01' })).toEqual([])
  })

  it('lists newest first, and breaks ties by when it was recorded', async () => {
    expect(list({}).map((e) => e.occurredAt.slice(0, 10))).toEqual(['2026-05-06', '2026-05-05', '2026-05-04', '2026-05-03', '2026-05-02', '2026-05-01'])
    await add(ev('task.created', 'tasks', { taskId: 't9', title: 'Tie A' }, { at: '2026-05-06T09:00:00.000Z', recordedAt: undefined }))
    const top = list({}).slice(0, 2)
    expect(top.every((e) => e.occurredAt.startsWith('2026-05-06'))).toBe(true)
  })

  it('searches inside what was written, ignoring case', () => {
    expect(list({ query: 'MILK' }).map((e) => e.data.title)).toEqual(['Buy milk'])
    expect(list({ query: 'guitar' })).toHaveLength(1)
    expect(list({ query: 'zebra' })).toEqual([])
  })

  it('does not let search reveal private contents while they are hidden', () => {
    expect(list({ query: 'kroger' })).toEqual([])
    expect(list({ query: 'secretnote' })).toEqual([])
    expect(list({ query: 'kroger', showPrivate: true })).toHaveLength(1)
    expect(list({ query: 'secretnote', showPrivate: true })).toHaveLength(1)
    // ...but its type and app can still be found
    expect(list({ query: 'money.purchase' })).toHaveLength(1)
  })

  it('offers the choices that are actually in the log', () => {
    const c = filterChoices(log.getEvents())
    expect(c.apps).toEqual(['body', 'evergrove', 'health', 'money', 'tasks'])
    expect(c.actors).toEqual(['jarvis', 'user'])
    expect(c.types).toContain('skill.practiced')
  })
})

describe('corrections are shown, never hidden', () => {
  it('marks an undone event as reversed and links the two', async () => {
    const r = await reg.invoke('tasks__add_task', { title: 'Buy milk' }, { now: NOW })
    await reg.undo(r.commandId)
    const c = analyzeCorrections(log.getEvents())
    const created = log.getEvents().find((e) => e.type === 'task.created')
    const reversal = log.getEvents().find((e) => e.type === 'event.reversed')
    expect(c.get(created.id)).toMatchObject({ status: 'reversed', by: [reversal.id] })
    expect(c.get(reversal.id)).toMatchObject({ status: 'reversal', target: created.id })
    // The viewer still lists everything: the task, its reversal, and the reversal of Jarvis's audit line.
    expect(list({ types: ['task.created', 'event.reversed'] }).map((e) => e.id)).toEqual(expect.arrayContaining([created.id, reversal.id]))
    expect(list({ types: ['task.created', 'event.reversed'] })).toHaveLength(3)
  })

  it('reversing a reversal brings the original back', async () => {
    await add(ev('task.created', 'tasks', { taskId: 'a', title: 'A' }))
    const original = log.getEvents()[0]
    await add(ev('event.reversed', 'tasks', {}, { supersedes: original.id }))
    const first = log.getEvents().find((e) => e.type === 'event.reversed')
    await add(ev('event.reversed', 'tasks', {}, { supersedes: first.id }))
    expect(analyzeCorrections(log.getEvents()).get(original.id).status).toBe('active')
  })

  it('calls an event replaced (not reversed) when a new version supersedes it', async () => {
    await add(ev('task.created', 'tasks', { taskId: 'a', title: 'Old' }))
    const old = log.getEvents()[0]
    await add(ev('task.created', 'tasks', { taskId: 'a', title: 'New' }, { supersedes: old.id }))
    expect(analyzeCorrections(log.getEvents()).get(old.id).status).toBe('replaced')
  })

  it('never changes the log: analysing and filtering append nothing', async () => {
    await seed()
    const before = JSON.stringify(log.getEvents())
    analyzeCorrections(log.getEvents())
    list({ query: 'milk' })
    exportJson(log.getEvents(), ctx())
    expect(JSON.stringify(log.getEvents())).toBe(before)
  })
})

describe('explaining growth, counting, and who wrote it', () => {
  it('says what an event grew, and nothing for an event that grew nothing', async () => {
    await seed()
    const c = ctx()
    const guitar = log.getEvents().find((e) => e.type === 'skill.practiced')
    const purchase = log.getEvents().find((e) => e.type === 'money.purchase.logged')
    expect(growthLines(guitar, c)).toEqual(['+8 xp Guitar (Craft & Career)'])
    expect(growthLines(purchase, c)).toEqual([])
  })

  it('counts events, dates and corrections', async () => {
    await seed()
    await add(ev('event.reversed', 'tasks', {}, { supersedes: log.getEvents()[3].id, at: '2026-05-20T12:00:00.000Z' }))
    expect(logStats(log.getEvents())).toEqual({ count: 7, first: expect.stringMatching(/^2026-05-0[12]$/), last: '2026-05-20', corrections: 1 })
    expect(logStats([])).toEqual({ count: 0, first: null, last: null, corrections: 0 })
  })

  it('stamps new events with the device that wrote them, and older ones read "earlier"', () => {
    setDeviceId('a1b2c3d4')
    const stamped = createEvent({ type: 'task.created', app: 'tasks', data: {} })
    setDeviceId(null)
    const plain = createEvent({ type: 'task.created', app: 'tasks', data: {} })
    expect(stamped.device).toBe('a1b2c3d4')
    expect('device' in plain).toBe(false)
    expect(deviceLabel(stamped)).toBe('device a1b2c3d4')
    expect(deviceLabel(plain)).toMatch(/^earlier/)
    expect(validateEvent(stamped)).toBeNull()
    expect(validateEvent({ ...stamped, device: 'x'.repeat(40) })).toBe('bad device')
  })

  it('a device stamp never breaks an older copy of the app: it is an extra, ignored field', () => {
    const stamped = { ...createEvent({ type: 'task.created', app: 'tasks', data: {} }), device: 'abc' }
    const { device, ...asOldCode } = stamped
    expect(device).toBe('abc')
    expect(validateEvent(asOldCode)).toBeNull()
  })
})

describe('exports round-trip (T-P3)', () => {
  beforeEach(seed)

  it('exports exactly the filtered events as JSON, masking private contents unless allowed', () => {
    const rows = list({ apps: ['tasks', 'money'] })
    const masked = JSON.parse(exportJson(rows, ctx()))
    expect(masked).toHaveLength(rows.length)
    expect(JSON.stringify(masked)).not.toContain('Kroger')
    expect(masked.find((r) => r.app === 'money').data).toEqual({ private: true })
    const open = JSON.parse(exportJson(rows, ctx(), { showPrivate: true }))
    expect(open.find((r) => r.app === 'money').data.merchant).toBe('Kroger')
    expect(open.map((r) => r.id).sort()).toEqual(rows.map((r) => r.id).sort())
  })

  it('exports CSV with one row per event and safe cells', async () => {
    await add(ev('task.created', 'tasks', { taskId: 'q', title: '=HYPERLINK("x")' }), ev('task.created', 'tasks', { taskId: 'r', title: 'Buy, "fresh"\nmilk' }))
    const rows = list({ apps: ['tasks'] })
    const csv = exportCsv(rows, ctx())
    const lines = csv.split('\n')
    expect(lines[0]).toBe('time,app,type,area,actor,device,status,summary')
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"')
    expect(csvCell('+1')).toBe("'+1")
    expect(csvCell('@cmd')).toBe("'@cmd")
    expect(csvCell('-5')).toBe("'-5")
    expect(csvCell('plain')).toBe('plain')
    expect(csv).toContain('"Task: Buy, ""fresh""')
    expect(csv).not.toContain('Kroger')
  })
})

describe('scale (T-P3)', () => {
  it('filters, searches and summarises 20,000 events quickly and correctly', () => {
    const events = []
    const apps = ['tasks', 'body', 'money', 'calendar']
    for (let i = 0; i < 20_000; i++) {
      const app = apps[i % apps.length]
      const day = String((i % 28) + 1).padStart(2, '0')
      events.push(
        app === 'money'
          ? ev('money.purchase.logged', 'money', { purchaseId: `p${i}`, amountCents: 100 + i, category: 'dining', date: `2026-04-${day}` }, { at: `2026-04-${day}T10:${String(i % 60).padStart(2, '0')}:00.000Z` })
          : ev('task.created', app, { taskId: `t${i}`, title: `Item ${i} ${i % 7 === 0 ? 'needle' : 'hay'}` }, { at: `2026-04-${day}T10:${String(i % 60).padStart(2, '0')}:00.000Z` })
      )
    }
    const t0 = performance.now()
    const c = buildViewContext(events)
    const all = filterEvents(events, {}, c)
    const needles = filterEvents(events, { query: 'needle' }, c)
    const range = filterEvents(events, { from: '2026-04-10', to: '2026-04-12', apps: ['tasks'] }, c)
    const ms = performance.now() - t0
    expect(all).toHaveLength(20_000)
    expect(needles.length).toBe(events.filter((e) => e.type === 'task.created' && e.data.title.endsWith('needle')).length)
    expect(range.every((e) => e.app === 'tasks' && e.occurredAt.slice(8, 10) >= '10' && e.occurredAt.slice(8, 10) <= '12')).toBe(true)
    expect(all[0].occurredAt >= all[19_999].occurredAt).toBe(true)
    expect(ms).toBeLessThan(5000)
  })
})
