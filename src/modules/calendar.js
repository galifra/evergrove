import { effectiveEvents, localDate } from '../core/events'
import { findOne } from '../core/match'

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

export function overlaps(a, b) {
  const aStart = a.allDay ? `${a.start}T00:00` : a.start
  const aEnd = a.allDay ? `${a.start}T23:59` : endOf(a)
  const bStart = b.allDay ? `${b.start}T00:00` : b.start
  const bEnd = b.allDay ? `${b.start}T23:59` : endOf(b)
  return aStart < bEnd && bStart < aEnd
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
        cancelled: false,
        history: [],
      })
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
  return state.events.filter((e) => e.id !== excludeId && overlaps(e, candidate))
}

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
    const upcoming = state.events.filter((e) => e.start.slice(0, 10) >= today).slice(0, 8)
    return upcoming.length
      ? 'Upcoming events: ' + upcoming.map((e) => `${e.title} (${e.start.replace('T', ' ')})`).join('; ')
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
        },
        required: ['title', 'start'],
      },
      run(args, { moduleState }) {
        const allDay = args.allDay ?? !args.start.includes('T')
        const candidate = { start: args.start, end: args.end ?? null, allDay }
        const clash = conflictsFor(moduleState(), candidate)
        const warn = clash.length ? ` Heads up: overlaps with ${clash.map((c) => c.title).join(', ')}.` : ''
        return {
          summary: `Added "${args.title}" on ${args.start.replace('T', ' at ')}.${warn}`,
          events: [
            {
              type: 'calendar.event.created',
              data: { eventId: uid(), title: args.title, start: args.start, end: args.end, allDay, place: args.place },
            },
          ],
        }
      },
    },
    {
      name: 'reschedule_event',
      tier: 'ask',
      description: 'Move an existing event to a new time (identify it by title).',
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
          summary: `Moved "${r.item.title}" to ${args.start.replace('T', ' at ')}.${warn}`,
          events: [{ type: 'calendar.event.rescheduled', data: { eventId: r.item.id, start: args.start, end: args.end } }],
        }
      },
    },
    {
      name: 'cancel_event',
      tier: 'ask',
      description: 'Cancel an event (identify it by title).',
      input: { type: 'object', properties: { event: { type: 'string', maxLength: 120 } }, required: ['event'] },
      run(args, { moduleState }) {
        const r = findOne(moduleState().events, args.event, { noun: 'event' })
        if (r.error) return { error: r.error }
        return { summary: `Cancelled "${r.item.title}".`, events: [{ type: 'calendar.event.cancelled', data: { eventId: r.item.id } }] }
      },
    },
  ],
}
