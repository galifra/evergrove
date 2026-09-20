import { effectiveEvents, localDate } from '@evergrove/core/events.js'
import { findOne } from '@evergrove/core/match.js'

let counter = 0
const uid = () => `cal-${Date.now().toString(36)}-${(counter++).toString(36)}`

// Times are local wall-clock strings ("2026-09-25T19:00") or dates for
// all-day events ("2026-09-25"). They compare correctly as plain strings.
const startKey = (ev) => ev.start
const endOf = (ev) => ev.end ?? (ev.allDay ? ev.start : addMinutes(ev.start, 60))

export function addMinutes(local, minutes) {
  const [date, time = '00:00'] = local.split('T')
  const [y, mo, d] = date.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  const dt = new Date(y, mo - 1, d, h, mi + minutes)
  const p = (n) => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}T${p(dt.getHours())}:${p(dt.getMinutes())}`
}

// "Sunday, Sep 27 at 9:00 AM" - shown next to every date so a wrong weekday is
// obvious the moment it happens.
export function describeLocal(local) {
  const [date, time] = String(local).split('T')
  const [y, m, d] = date.split('-').map(Number)
  const day = new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
  if (!time) return day
  const [h, mi] = time.split(':').map(Number)
  const t = new Date(2000, 0, 1, h, mi).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `${day} at ${t}`
}

// All-day items are day markers, not blocks of time, so they never conflict.
export function overlaps(a, b) {
  if (a.allDay || b.allDay) return false
  const aStart = a.start
  const aEnd = endOf(a)
  const bStart = b.start
  const bEnd = endOf(b)
  return aStart < bEnd && bStart < aEnd
}

const FREQS = ['daily', 'weekly', 'monthly', 'yearly']
const p2 = (n) => String(n).padStart(2, '0')
const ymd = (y, m, d) => `${y}-${p2(m)}-${p2(d)}`
const utcDay = (date) => {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86400000
}
const fromUtcDay = (n) => {
  const dt = new Date(n * 86400000)
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
}
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate()

// The date of occurrence number n of a repeating event that starts on `date`.
// Monthly and yearly count from the original date (not from the previous
// occurrence), so a Jan 31 event lands on Feb 28, then Mar 31 - never drifting.
export function occurrenceDate(date, rec, n) {
  const every = rec.every ?? 1
  if (rec.freq === 'daily') return fromUtcDay(utcDay(date) + n * every)
  if (rec.freq === 'weekly') return fromUtcDay(utcDay(date) + n * 7 * every)
  const [y, m, d] = date.split('-').map(Number)
  const months = rec.freq === 'monthly' ? n * every : n * 12 * every
  const total = y * 12 + (m - 1) + months
  const ty = Math.floor(total / 12)
  const tm = (total % 12) + 1
  return ymd(ty, tm, Math.min(d, daysInMonth(ty, tm)))
}

const minutesBetween = (a, b) => {
  const [ad, at = '00:00'] = a.split('T')
  const [bd, bt = '00:00'] = b.split('T')
  const [ah, am] = at.split(':').map(Number)
  const [bh, bm] = bt.split(':').map(Number)
  return (utcDay(bd) - utcDay(ad)) * 1440 + (bh * 60 + bm) - (ah * 60 + am)
}

// Every occurrence that falls between two dates (inclusive), repeating events
// expanded, skipped ones and cancelled series left out. Each item carries
// `seriesId` (the event the user created) and a unique `id` per occurrence.
export function expandCalendar(state, fromDate, toDate) {
  const out = []
  for (const ev of state.events) {
    const startDate = ev.start.slice(0, 10)
    const time = ev.start.includes('T') ? ev.start.slice(10) : ''
    if (!ev.recurrence) {
      if (startDate >= fromDate && startDate <= toDate) out.push({ ...ev, seriesId: ev.id, occurrence: startDate })
      continue
    }
    const span = ev.end && !ev.allDay ? minutesBetween(ev.start, ev.end) : null
    for (let n = 0; n < 4000; n++) {
      const date = occurrenceDate(startDate, ev.recurrence, n)
      if (date > toDate || (ev.recurrence.until && date > ev.recurrence.until)) break
      if (date < fromDate || ev.skipped.has(date)) continue
      const start = date + time
      out.push({
        ...ev,
        id: `${ev.id}@${date}`,
        seriesId: ev.id,
        occurrence: date,
        start,
        end: span === null ? null : addMinutes(start, span),
      })
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title))
}

export function deriveCalendar(events) {
  const map = new Map()
  for (const e of effectiveEvents(events)) {
    const d = e.data
    if (e.type === 'calendar.event.created') {
      map.set(d.eventId, {
        id: d.eventId,
        title: d.title,
        start: d.start,
        end: d.end ?? null,
        allDay: !!d.allDay,
        place: d.place ?? '',
        notes: d.notes ?? '',
        recurrence: FREQS.includes(d.repeat) ? { freq: d.repeat, every: d.repeatEvery ?? 1, until: d.repeatUntil ?? null } : null,
        skipped: new Set(),
        cancelled: false,
        history: [],
      })
    } else if (e.type === 'calendar.event.skipped') {
      map.get(d.eventId)?.skipped.add(d.date)
    } else if (e.type === 'calendar.event.rescheduled') {
      const ev = map.get(d.eventId)
      if (ev) {
        ev.history.push({ start: ev.start, end: ev.end })
        ev.start = d.start
        ev.end = d.end ?? null
      }
    } else if (e.type === 'calendar.event.cancelled') {
      const ev = map.get(d.eventId)
      if (ev) ev.cancelled = true
    }
  }
  const live = [...map.values()].filter((x) => !x.cancelled).sort((a, b) => startKey(a).localeCompare(startKey(b)))
  return { events: live, all: [...map.values()] }
}

export function conflictsFor(state, candidate, excludeId = null) {
  const first = candidate.start.slice(0, 10)
  const last = (candidate.end ?? candidate.start).slice(0, 10)
  return expandCalendar(state, first, last).filter((e) => e.seriesId !== excludeId && overlaps(e, candidate))
}

export const REPEAT_LABEL = (r) =>
  !r ? '' : r.every > 1 ? `every ${r.every} ${{ daily: 'days', weekly: 'weeks', monthly: 'months', yearly: 'years' }[r.freq]}` : r.freq

const ISO_LOCAL = '^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2})?$'

export const calendarModule = {
  id: 'calendar',
  name: 'Calendar',
  icon: 'calendar',
  area: 'discipline',
  description: 'Events, plans and conflicts in one agenda.',
  derive: deriveCalendar,
  context(state, now = new Date()) {
    const today = localDate(now)
    const seen = new Map()
    // A repeating event only needs its next couple of dates, or it would crowd everything else out.
    const upcoming = expandCalendar(state, today, fromUtcDay(utcDay(today) + 365))
      .filter((e) => {
        const n = (seen.get(e.seriesId) ?? 0) + 1
        seen.set(e.seriesId, n)
        return n <= 2
      })
      .slice(0, 8)
    return upcoming.length
      ? 'Upcoming events: ' +
          upcoming.map((e) => `${e.title} (${e.start.replace('T', ' ')}${e.recurrence ? `, repeats ${REPEAT_LABEL(e.recurrence)}` : ''})`).join('; ')
      : ''
  },
  actions: [
    {
      name: 'add_event',
      tier: 'auto',
      description: 'Add an event to the calendar. Use local time as YYYY-MM-DDTHH:mm, or YYYY-MM-DD for all-day.',
      input: {
        type: 'object',
        properties: {
          title: { type: 'string', maxLength: 120 },
          start: { type: 'string', pattern: ISO_LOCAL },
          end: { type: 'string', pattern: ISO_LOCAL },
          allDay: { type: 'boolean' },
          place: { type: 'string', maxLength: 120 },
          repeat: { type: 'string', enum: FREQS, description: 'Makes it repeat on the same day each period: daily, weekly, monthly or yearly' },
          repeatEvery: { type: 'integer', minimum: 1, maximum: 12, description: 'Every N periods (2 with weekly = every 2 weeks). Default 1.' },
          repeatUntil: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Last date it repeats, if it ends' },
        },
        required: ['title', 'start'],
      },
      run(args, { moduleState }) {
        const allDay = args.allDay ?? !args.start.includes('T')
        const candidate = { start: args.start, end: args.end ?? null, allDay }
        const clash = conflictsFor(moduleState(), candidate)
        const warn = clash.length ? ` Heads up: overlaps with ${clash.map((c) => c.title).join(', ')}.` : ''
        if ((args.repeatEvery || args.repeatUntil) && !args.repeat) return { error: 'Say how it repeats: daily, weekly, monthly or yearly.' }
        if (args.repeatUntil && args.repeatUntil < args.start.slice(0, 10)) return { error: 'The repeat end date is before the event starts.' }
        const rec = args.repeat ? { freq: args.repeat, every: args.repeatEvery ?? 1 } : null
        return {
          summary: `Added "${args.title}" on ${describeLocal(args.start)}${rec ? `, repeating ${REPEAT_LABEL(rec)}${args.repeatUntil ? ` until ${args.repeatUntil}` : ''}` : ''}.${warn}`,
          events: [
            {
              type: 'calendar.event.created',
              data: {
                eventId: uid(),
                title: args.title,
                start: args.start,
                end: args.end,
                allDay,
                place: args.place,
                repeat: args.repeat,
                repeatEvery: args.repeat ? args.repeatEvery ?? 1 : undefined,
                repeatUntil: args.repeatUntil,
              },
            },
          ],
        }
      },
    },
    {
      name: 'reschedule_event',
      tier: 'ask',
      description: 'Move an existing event to a new time (identify it by title). For a repeating event this moves the whole series.',
      input: {
        type: 'object',
        properties: {
          event: { type: 'string', maxLength: 120 },
          start: { type: 'string', pattern: ISO_LOCAL },
          end: { type: 'string', pattern: ISO_LOCAL },
        },
        required: ['event', 'start'],
      },
      run(args, { moduleState }) {
        const state = moduleState()
        const r = findOne(state.events, args.event, { noun: 'event' })
        if (r.error) return { error: r.error }
        const candidate = { ...r.item, start: args.start, end: args.end ?? null }
        const clash = conflictsFor(state, candidate, r.item.id)
        const warn = clash.length ? ` Heads up: overlaps with ${clash.map((c) => c.title).join(', ')}.` : ''
        return {
          summary: `Moved "${r.item.title}" to ${describeLocal(args.start)}.${warn}`,
          events: [{ type: 'calendar.event.rescheduled', data: { eventId: r.item.id, start: args.start, end: args.end } }],
        }
      },
    },
    {
      name: 'cancel_event',
      tier: 'ask',
      description: 'Cancel an event (identify it by title). For a repeating event this cancels the whole series; use skip_occurrence to drop just one date.',
      input: { type: 'object', properties: { event: { type: 'string', maxLength: 120 } }, required: ['event'] },
      run(args, { moduleState }) {
        const r = findOne(moduleState().events, args.event, { noun: 'event' })
        if (r.error) return { error: r.error }
        return {
          summary: `Cancelled "${r.item.title}"${r.item.recurrence ? ' (the whole series)' : ''}.`,
          events: [{ type: 'calendar.event.cancelled', data: { eventId: r.item.id } }],
        }
      },
    },
    {
      name: 'skip_occurrence',
      tier: 'ask',
      description: 'Skip one date of a repeating event without cancelling the rest (identify it by title, give the date to skip).',
      input: {
        type: 'object',
        properties: { event: { type: 'string', maxLength: 120 }, date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } },
        required: ['event', 'date'],
      },
      run(args, { moduleState }) {
        const state = moduleState()
        const r = findOne(state.events.filter((e) => e.recurrence), args.event, { noun: 'repeating event' })
        if (r.error) return { error: r.error }
        if (!expandCalendar(state, args.date, args.date).some((o) => o.seriesId === r.item.id)) {
          return { error: `"${r.item.title}" doesn't happen on ${describeLocal(args.date)}.` }
        }
        return {
          summary: `Skipped "${r.item.title}" on ${describeLocal(args.date)}. The other dates are unchanged.`,
          events: [{ type: 'calendar.event.skipped', data: { eventId: r.item.id, date: args.date } }],
        }
      },
    },
  ],
}
