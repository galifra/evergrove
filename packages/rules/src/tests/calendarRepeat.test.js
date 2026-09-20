import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { openStore } from '@evergrove/core/store.js'
import { createLog } from '@evergrove/core/log.js'
import { createAppRegistry } from '../registry'
import { deriveCalendar, expandCalendar, occurrenceDate } from '@evergrove/modules/calendar.js'
import { deriveToday } from '../today'
import { composeBriefing } from '../briefing'

const NOW = new Date(2026, 4, 15, 12) // Fri 2026-05-15
let log
let reg
beforeEach(async () => {
  log = createLog(await openStore(`cr-${Math.random()}`), { channelName: `crc-${Math.random()}` })
  reg = createAppRegistry(log)
})
const call = (n, a, opts = {}) => reg.invoke(n, a, { now: NOW, ...opts })
const cal = () => deriveCalendar(log.getEvents())
const days = (from, to) => expandCalendar(cal(), from, to).map((e) => e.start)

describe('occurrence dates', () => {
  it('daily and weekly step by whole days, across month ends', () => {
    expect(occurrenceDate('2026-01-30', { freq: 'daily' }, 3)).toBe('2026-02-02')
    expect(occurrenceDate('2026-05-15', { freq: 'weekly', every: 2 }, 2)).toBe('2026-06-12')
  })

  it('monthly clamps to the end of short months without drifting', () => {
    const rec = { freq: 'monthly' }
    expect(occurrenceDate('2026-01-31', rec, 1)).toBe('2026-02-28')
    expect(occurrenceDate('2026-01-31', rec, 2)).toBe('2026-03-31')
    expect(occurrenceDate('2026-01-31', rec, 3)).toBe('2026-04-30')
    expect(occurrenceDate('2026-11-15', rec, 3)).toBe('2027-02-15')
  })

  it('yearly handles Feb 29 and quarterly steps', () => {
    expect(occurrenceDate('2028-02-29', { freq: 'yearly' }, 1)).toBe('2029-02-28')
    expect(occurrenceDate('2028-02-29', { freq: 'yearly' }, 4)).toBe('2032-02-29')
    expect(occurrenceDate('2026-01-15', { freq: 'monthly', every: 3 }, 1)).toBe('2026-04-15')
  })
})

describe('repeating calendar events', () => {
  it('expands a weekly event inside a window, keeping the time', async () => {
    const r = await call('calendar__add_event', { title: 'Team sync', start: '2026-05-18T10:00', end: '2026-05-18T11:00', repeat: 'weekly' })
    expect(r.summary).toMatch(/repeating weekly/)
    const list = expandCalendar(cal(), '2026-05-15', '2026-06-08')
    expect(list.map((e) => e.start)).toEqual(['2026-05-18T10:00', '2026-05-25T10:00', '2026-06-01T10:00', '2026-06-08T10:00'])
    expect(list[1].end).toBe('2026-05-25T11:00')
    expect(new Set(list.map((e) => e.id)).size).toBe(4)
    expect(list.every((e) => e.seriesId === list[0].seriesId)).toBe(true)
  })

  it('never lists occurrences before it starts, and honours the end date', async () => {
    await call('calendar__add_event', { title: 'Course', start: '2026-05-20', repeat: 'daily', repeatUntil: '2026-05-22' })
    expect(days('2026-05-01', '2026-06-30')).toEqual(['2026-05-20', '2026-05-21', '2026-05-22'])
  })

  it('every-other-week works', async () => {
    await call('calendar__add_event', { title: 'Payday', start: '2026-05-15', repeat: 'weekly', repeatEvery: 2 })
    expect(days('2026-05-15', '2026-06-15')).toEqual(['2026-05-15', '2026-05-29', '2026-06-12'])
  })

  it('skipping one date leaves the rest, and needs approval', async () => {
    await call('calendar__add_event', { title: 'Yoga', start: '2026-05-18T18:00', repeat: 'weekly' })
    expect((await call('calendar__skip_occurrence', { event: 'yoga', date: '2026-05-25' })).status).toBe('needs-approval')
    const r = await call('calendar__skip_occurrence', { event: 'yoga', date: '2026-05-25' }, { approved: true })
    expect(r.status).toBe('done')
    expect(days('2026-05-15', '2026-06-08')).toEqual(['2026-05-18T18:00', '2026-06-01T18:00', '2026-06-08T18:00'])
    await reg.undo(r.commandId)
    expect(days('2026-05-15', '2026-06-01')).toContain('2026-05-25T18:00')
  })

  it('refuses to skip a date the event does not happen on', async () => {
    await call('calendar__add_event', { title: 'Yoga', start: '2026-05-18T18:00', repeat: 'weekly' })
    const r = await call('calendar__skip_occurrence', { event: 'yoga', date: '2026-05-19' }, { approved: true })
    expect(r.status).toBe('error')
  })

  it('cancelling removes the whole series', async () => {
    await call('calendar__add_event', { title: 'Yoga', start: '2026-05-18T18:00', repeat: 'weekly' })
    const r = await call('calendar__cancel_event', { event: 'yoga' }, { approved: true })
    expect(r.summary).toMatch(/whole series/)
    expect(days('2026-05-01', '2026-12-31')).toEqual([])
  })

  it('moving a series shifts every occurrence', async () => {
    await call('calendar__add_event', { title: 'Yoga', start: '2026-05-18T18:00', repeat: 'weekly' })
    await call('calendar__reschedule_event', { event: 'yoga', start: '2026-05-19T18:00' }, { approved: true })
    expect(days('2026-05-15', '2026-06-02')).toEqual(['2026-05-19T18:00', '2026-05-26T18:00', '2026-06-02T18:00'])
  })

  it('flags a clash with a later occurrence of a repeating event', async () => {
    await call('calendar__add_event', { title: 'Team sync', start: '2026-05-18T10:00', repeat: 'weekly' })
    const r = await call('calendar__add_event', { title: 'Dentist', start: '2026-06-08T10:30' })
    expect(r.summary).toMatch(/overlaps with Team sync/)
  })

  it('rejects bad repeat input instead of guessing', async () => {
    expect((await call('calendar__add_event', { title: 'x', start: '2026-05-18', repeatEvery: 2 })).status).toBe('error')
    expect((await call('calendar__add_event', { title: 'x', start: '2026-05-18', repeat: 'weekly', repeatUntil: '2026-05-01' })).status).toBe('error')
    expect((await call('calendar__add_event', { title: 'x', start: '2026-05-18', repeat: 'hourly' })).status).toBe('error')
  })

  it('shows up in Today, in tomorrow\'s briefing, and in what Jarvis is told', async () => {
    await call('calendar__add_event', { title: 'Standup', start: '2026-05-11T09:00', repeat: 'daily' })
    expect(deriveToday(log.getEvents(), NOW).map((i) => i.text).join(' ')).toMatch(/Standup at 09:00/)
    expect(composeBriefing(log.getEvents(), NOW).body).toMatch(/Standup/)
    const ctx = reg.modules().find((m) => m.id === 'calendar').context(cal(), NOW)
    expect(ctx).toMatch(/Standup \(2026-05-15 09:00, repeats daily\)/)
    expect(ctx.match(/Standup/g)).toHaveLength(2)
  })
})
