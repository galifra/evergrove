import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { openStore } from '../core/store'
import { createLog } from '../core/log'
import { createAppRegistry } from '../modules'
import { deriveToday, visibleToday, snoozeUntil } from './today'

const NOW = new Date(2026, 4, 15, 12, 0, 0) // Fri May 15 2026

let log
let reg
beforeEach(async () => {
  log = createLog(await openStore(`t-${Math.random()}`), { channelName: `tc-${Math.random()}` })
  reg = createAppRegistry(log)
})
const run = (n, a) => reg.invoke(n, a, { now: NOW, actor: 'user', approved: true })
const today = () => deriveToday(log.getEvents(), NOW)

describe('the Today list', () => {
  it('is empty when nothing needs you', () => {
    expect(today()).toEqual([])
  })

  it('puts overdue bills first, then due-soon bills and due tasks', async () => {
    await run('money__add_bill', { name: 'Phone', amount: 60, cadence: 'monthly', dueDay: 1 }) // overdue
    await run('money__add_bill', { name: 'Rent', amount: 1200, cadence: 'monthly', dueDay: 17 }) // in 2 days
    await run('money__add_bill', { name: 'Gym', amount: 30, cadence: 'monthly', dueDay: 28 }) // not soon
    await run('tasks__add_task', { title: 'File taxes', due: '2026-05-15' })
    const t = today()
    expect(t[0]).toMatchObject({ kind: 'bill', priority: 1 })
    expect(t[0].text).toMatch(/Phone.*overdue/)
    expect(t.map((x) => x.text).join(' ')).toMatch(/Rent.*in 2 days/)
    expect(t.map((x) => x.text).join(' ')).toMatch(/"File taxes" is due today/)
    expect(t.map((x) => x.text).join(' ')).not.toMatch(/Gym/)
  })

  it("lists today's events, uncompleted daily habits, and birthdays this week", async () => {
    await run('calendar__add_event', { title: 'Dentist', start: '2026-05-15T15:00' })
    await run('calendar__add_event', { title: 'Later', start: '2026-05-16T15:00' })
    await run('tasks__add_habit', { name: 'Stretch', area: 'health' })
    await run('people__save_person', { name: 'Sam', birthday: '05-18' })
    await run('people__save_person', { name: 'Far Away', birthday: '09-01' })
    const text = today().map((x) => x.text).join(' | ')
    expect(text).toMatch(/Dentist at 15:00/)
    expect(text).not.toMatch(/Later/)
    expect(text).toMatch(/Stretch isn't checked off yet/)
    expect(text).toMatch(/Sam's birthday is in 3 days/)
    expect(text).not.toMatch(/Far Away/)
  })

  it('a habit stops nagging once it is checked, and a paid bill disappears', async () => {
    await run('tasks__add_habit', { name: 'Stretch', area: 'health' })
    await run('money__add_bill', { name: 'Rent', amount: 1200, cadence: 'monthly', dueDay: 16 })
    await run('tasks__check_habit', { habit: 'stretch' })
    await run('money__pay_bill', { bill: 'rent' })
    expect(today()).toEqual([])
  })

  it('flags a quiet area, but not one you paused', async () => {
    await run('evergrove__practice_skill', { area: 'health', skill: 'Running', xp: 8 })
    const later = new Date(2026, 4, 30, 12)
    expect(deriveToday(log.getEvents(), later).some((i) => i.id === 'quiet:health')).toBe(true)
    await run('evergrove__pause_area', { area: 'health' })
    expect(deriveToday(log.getEvents(), later).some((i) => i.id === 'quiet:health')).toBe(false)
  })
})

describe('dismissing', () => {
  it('hides an item until its snooze date and lets it return after', async () => {
    await run('money__add_bill', { name: 'Rent', amount: 1200, cadence: 'monthly', dueDay: 16 })
    const [item] = today()
    const until = snoozeUntil(item, NOW)
    expect(until).toBe('2026-05-16')
    expect(visibleToday([item], { [item.id]: until }, NOW)).toEqual([])
    expect(visibleToday([item], { [item.id]: until }, new Date(2026, 4, 16, 9))).toEqual([item])
  })

  it('quiet-area nudges stay dismissed for a week', () => {
    expect(snoozeUntil({ id: 'quiet:health', snoozeDays: 7 }, NOW)).toBe('2026-05-22')
  })
})
