import 'fake-indexeddb/auto'
import { describe, it, expect } from 'vitest'
import { openStore } from '../core/store'
import { createLog } from '../core/log'
import { validateEvent, createEvent } from '../core/events'
import { createAppRegistry } from '../modules'
import { deriveEvergrove } from '../evergrove/derive'
import { legacyToEvents } from '../evergrove/migrate'
import { deriveTasks } from '../modules/tasks'
import { deriveMoney } from '../modules/money'
import { deriveCalendar } from '../modules/calendar'

// Restore drill (backlog T1.5): everything you can export must import back into
// a brand-new device with nothing lost, nothing doubled.

const NOW = new Date(2026, 4, 15, 12, 0, 0)

async function freshLog() {
  const store = await openStore(`b-${Math.random()}`)
  return createLog(store, { channelName: `bc-${Math.random()}` })
}

// Same steps the app's export button and importEvents perform.
const exportPayload = (log) => JSON.parse(JSON.stringify({ format: 'evergrove-backup', version: 2, events: log.getEvents() }))
async function importInto(log, payload) {
  const valid = payload.events.filter((e) => !validateEvent(e))
  const added = await log.append(valid, { remote: true })
  return { total: payload.events.length, valid: valid.length, added: added.length }
}

async function buildLife() {
  const log = await freshLog()
  const reg = createAppRegistry(log)
  const run = (n, a) => reg.invoke(n, a, { now: NOW, actor: 'user', approved: true })
  await run('evergrove__practice_skill', { area: 'health', skill: 'Running', xp: 12 })
  await run('evergrove__log_tracker_entry', { tracker: 'body', values: { kind: 'Lifting', minutes: 40 } })
  await run('tasks__add_task', { title: 'File taxes', effort: 3 })
  await run('tasks__complete_task', { task: 'taxes' })
  await run('tasks__add_habit', { name: 'Stretch', area: 'health' })
  await run('tasks__check_habit', { habit: 'stretch' })
  await run('calendar__add_event', { title: 'Dinner with Sam', start: '2026-05-20T19:00' })
  await run('money__log_purchase', { amount: 42.5, category: 'dining' })
  await run('money__add_bill', { name: 'Rent', amount: 1200, cadence: 'monthly', dueDay: 20 })
  await run('goals__create_goal', { title: 'Run a 10k', area: 'health', milestones: ['3k', '5k'] })
  const undone = await run('evergrove__practice_skill', { area: 'mind', skill: 'Chess', xp: 9 })
  await reg.undo(undone.commandId)
  await log.append(createEvent({ type: 'tree.named', app: 'evergrove', actor: 'user', data: { name: 'Restored Grove' } }))
  return log
}

const snapshot = (log) => {
  const ev = log.getEvents()
  return JSON.stringify({
    tree: deriveEvergrove(ev),
    tasks: deriveTasks(ev, NOW),
    money: deriveMoney(ev, NOW),
    calendar: deriveCalendar(ev),
  }, (k, v) => (v instanceof Set ? [...v].sort() : v))
}

describe('backup and restore', () => {
  it('a full export restores every app exactly onto a brand-new device', async () => {
    const original = await buildLife()
    const payload = exportPayload(original)
    const device = await freshLog()
    const r = await importInto(device, payload)
    expect(r.added).toBe(payload.events.length)
    expect(snapshot(device)).toBe(snapshot(original))
    expect(deriveEvergrove(device.getEvents()).treeName).toBe('Restored Grove')
    expect(deriveEvergrove(device.getEvents()).skills.mind).toBeUndefined() // the undone entry stays undone
  })

  it('importing the same backup twice adds nothing', async () => {
    const original = await buildLife()
    const payload = exportPayload(original)
    const device = await freshLog()
    await importInto(device, payload)
    expect((await importInto(device, payload)).added).toBe(0)
    expect(snapshot(device)).toBe(snapshot(original))
  })

  it('merging a backup into a device that already has newer data keeps both', async () => {
    const original = await buildLife()
    const payload = exportPayload(original)
    const device = await freshLog()
    const reg = createAppRegistry(device)
    await reg.invoke('tasks__add_task', { title: 'Buy milk' }, { now: NOW, actor: 'user', approved: true })
    await importInto(device, payload)
    const titles = deriveTasks(device.getEvents(), NOW).all.map((t) => t.title).sort()
    expect(titles).toEqual(['Buy milk', 'File taxes'])
  })

  it('invalid rows in a damaged backup are skipped, the rest still restore', async () => {
    const original = await buildLife()
    const payload = exportPayload(original)
    payload.events.splice(1, 0, { id: 'junk', type: 'nope' }, null)
    const device = await freshLog()
    const r = await importInto(device, { events: payload.events.filter(Boolean) })
    expect(r.valid).toBe(r.total - 1)
    expect(deriveEvergrove(device.getEvents()).skills.health.running.xp).toBe(12)
  })

  it('an old-format backup (skills and entries) still imports', async () => {
    const legacy = {
      skills: { health: { running: { id: 'running', name: 'Running', xp: 20, createdAt: '2026-01-01T00:00:00.000Z' } } },
      entries: [{ id: 'e1', text: 'ran', createdAt: '2026-01-02T00:00:00.000Z', updates: [{ domain: 'health', skillId: 'running', skillName: 'Running', xpGain: 20 }] }],
    }
    const device = await freshLog()
    await importInto(device, { events: legacyToEvents(legacy) })
    expect(deriveEvergrove(device.getEvents()).skills.health.running.xp).toBe(20)
  })
})
