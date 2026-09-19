import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { openStore } from '../core/store'
import { createLog } from '../core/log'
import { createAppRegistry } from '../modules'
import { composeBriefing } from './briefing'

const NOW = new Date(2026, 4, 15, 21, 0, 0) // Fri May 15 2026, 9pm. Tomorrow is Sat May 16.

let log
let reg
beforeEach(async () => {
  log = createLog(await openStore(`br-${Math.random()}`), { channelName: `brc-${Math.random()}` })
  reg = createAppRegistry(log)
})
const run = (n, a) => reg.invoke(n, a, { now: NOW, actor: 'user', approved: true })
const brief = (prefs) => composeBriefing(log.getEvents(), NOW, prefs)

describe("tomorrow's briefing", () => {
  it('names tomorrow in the title', () => {
    expect(brief().title).toBe('Tomorrow · Sat, May 16')
  })

  it('says so plainly when nothing is scheduled', () => {
    const b = brief()
    expect(b.lines[0]).toBe('Nothing scheduled.')
    expect(b.total).toBe(0)
  })

  it("lists tomorrow's events in time order, all-day last, and ignores other days", async () => {
    await run('calendar__add_event', { title: 'Lunch with Alex', start: '2026-05-16T13:00' })
    await run('calendar__add_event', { title: 'Help Theo move', start: '2026-05-16T09:30' })
    await run('calendar__add_event', { title: 'Church picnic', start: '2026-05-16' })
    await run('calendar__add_event', { title: 'Not tomorrow', start: '2026-05-17T10:00' })
    await run('calendar__add_event', { title: 'Yesterday', start: '2026-05-14T10:00' })
    const b = brief()
    expect(b.lines.slice(0, 3)).toEqual(['Church picnic (all day)', '9:30 AM Help Theo move', '1:00 PM Lunch with Alex'])
    expect(b.lines.join(' ')).not.toMatch(/Not tomorrow|Yesterday/)
    expect(b.counts.events).toBe(3)
  })

  it('follows reschedules and cancellations', async () => {
    await run('calendar__add_event', { title: 'Dinner with Sam', start: '2026-05-20T19:00' })
    await run('calendar__add_event', { title: 'Dentist', start: '2026-05-16T15:00' })
    await run('calendar__reschedule_event', { event: 'dinner', start: '2026-05-16T19:00' })
    await run('calendar__cancel_event', { event: 'dentist' })
    expect(brief().lines[0]).toBe('7:00 PM Dinner with Sam')
    expect(brief().counts.events).toBe(1)
  })

  it('includes tasks and bills due tomorrow, and birthdays', async () => {
    await run('tasks__add_task', { title: 'Renew license', due: '2026-05-16' })
    await run('tasks__add_task', { title: 'Next week thing', due: '2026-05-22' })
    await run('money__add_bill', { name: 'Rent', amount: 1200, cadence: 'monthly', dueDay: 16 })
    await run('people__save_person', { name: 'Sam', birthday: '05-16' })
    const text = brief().lines.join(' | ')
    expect(text).toMatch(/Due: Renew license/)
    expect(text).toMatch(/Rent is due/)
    expect(text).toMatch(/Sam's birthday/)
    expect(text).not.toMatch(/Next week thing/)
  })

  it('keeps bill amounts off the lock screen unless you opt in', async () => {
    await run('money__add_bill', { name: 'Rent', amount: 1200, cadence: 'monthly', dueDay: 16 })
    expect(brief().body).not.toMatch(/1,200|\$/)
    expect(brief({ showAmounts: true }).body).toMatch(/Rent \$1,200\.00 is due/)
  })

  it('counts-only mode reveals no names at all', async () => {
    await run('calendar__add_event', { title: 'Secret meeting', start: '2026-05-16T09:00' })
    await run('tasks__add_task', { title: 'Private errand', due: '2026-05-16' })
    await run('people__save_person', { name: 'Someone', birthday: '05-16' })
    const b = brief({ detail: 'counts' })
    expect(b.lines[0]).toBe('1 event, 1 task due, 1 birthday.')
    expect(b.body).not.toMatch(/Secret|Private|Someone/)
  })

  it('mentions overdue items without listing them as tomorrow', async () => {
    await run('tasks__add_task', { title: 'Old task', due: '2026-05-01' })
    await run('money__add_bill', { name: 'Phone', amount: 60, cadence: 'monthly', dueDay: 1 })
    const b = brief()
    expect(b.counts.overdue).toBe(2)
    expect(b.lines).toContain('2 overdue items waiting.')
    expect(b.body).not.toMatch(/Old task/)
  })

  it('caps the list so a notification stays readable', async () => {
    for (let i = 0; i < 8; i++) await run('calendar__add_event', { title: `Thing ${i}`, start: `2026-05-16T${String(8 + i).padStart(2, '0')}:00` })
    const b = brief()
    expect(b.lines.filter((l) => !l.startsWith("You haven't")).length).toBe(5)
    expect(b.lines).toContain('...and 4 more')
  })

  it("nudges only when nothing was logged today", async () => {
    expect(brief().lines.at(-1)).toBe("You haven't logged anything today.")
    await run('evergrove__practice_skill', { area: 'health', skill: 'Running', xp: 8 })
    expect(brief().lines.join(' ')).not.toMatch(/haven't logged/)
    expect(brief().loggedToday).toBe(true)
  })
})
