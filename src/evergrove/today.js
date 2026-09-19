import { localDate } from '../core/events'
import { deriveEvergrove } from './derive'
import { deriveInsights } from './insights'
import { deriveTasks } from '../modules/tasks'
import { deriveCalendar } from '../modules/calendar'
import { deriveMoney, formatCents } from '../modules/money'
import { derivePeople } from '../modules/people'

// One calm list for "what needs me today", pulled from every app. Pure and
// derived: nothing here is stored, so it can never drift from the real data.
// Each item has a stable id so dismissing it once doesn't bring it back the
// same day, and date-scoped ids let it return naturally when it becomes relevant again.

const dayLabel = (iso) => new Date(`${iso}T00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

export function deriveToday(events, now = new Date()) {
  const today = localDate(now)
  const items = []

  const money = deriveMoney(events, now)
  for (const b of money.bills) {
    if (b.paid) continue
    if (b.overdue) {
      items.push({ id: `bill:${b.id}:${b.period}`, priority: 1, kind: 'bill', route: '/app/money', text: `${b.name} (${formatCents(b.amountCents)}) is overdue since ${dayLabel(b.dueOn)}.` })
    } else if (b.daysUntil <= 3) {
      const when = b.daysUntil === 0 ? 'today' : b.daysUntil === 1 ? 'tomorrow' : `in ${b.daysUntil} days`
      items.push({ id: `bill:${b.id}:${b.period}`, priority: 2, kind: 'bill', route: '/app/money', text: `${b.name} (${formatCents(b.amountCents)}) is due ${when}.` })
    }
  }

  const tasks = deriveTasks(events, now)
  for (const t of tasks.open) {
    if (!t.due) continue
    if (t.due < today) items.push({ id: `task:${t.id}`, priority: 2, kind: 'task', route: '/app/tasks', text: `"${t.title}" was due ${dayLabel(t.due)}.` })
    else if (t.due === today) items.push({ id: `task:${t.id}`, priority: 2, kind: 'task', route: '/app/tasks', text: `"${t.title}" is due today.` })
  }

  const cal = deriveCalendar(events)
  const todays = cal.events.filter((e) => e.start.slice(0, 10) === today)
  for (const e of todays) {
    const when = e.allDay ? 'today' : e.start.slice(11)
    items.push({ id: `event:${e.id}:${today}`, priority: 3, kind: 'event', route: '/app/calendar', text: `${e.title} at ${when}.`.replace('at today', 'today') })
  }

  const undone = tasks.habits.filter((h) => h.cadence === 'daily' && !h.checkedToday)
  if (undone.length) {
    const first = undone[0]
    items.push({
      id: `habits:${today}`,
      priority: 3,
      kind: 'habit',
      route: '/app/tasks',
      text:
        undone.length === 1
          ? `${first.name} isn't checked off yet${first.streak ? ` (${plural(first.streak, 'day')} streak to keep)` : ''}.`
          : `${plural(undone.length, 'habit')} not checked off yet: ${undone.slice(0, 3).map((h) => h.name).join(', ')}.`,
    })
  }

  const people = derivePeople(events, now)
  for (const p of people.upcomingBirthdays) {
    if (p.nextBirthday.inDays > 7) continue
    const when = p.nextBirthday.inDays === 0 ? 'today' : p.nextBirthday.inDays === 1 ? 'tomorrow' : `in ${p.nextBirthday.inDays} days`
    items.push({ id: `birthday:${p.id}:${p.nextBirthday.date}`, priority: 3, kind: 'birthday', route: '/app/people', text: `${p.name}'s birthday is ${when}.` })
  }

  for (const i of deriveInsights(deriveEvergrove(events), now)) {
    if (i.kind === 'quiet') items.push({ id: i.id, priority: 4, kind: 'quiet', route: '/', text: i.message, snoozeDays: 7 })
  }

  return items.sort((a, b) => a.priority - b.priority || a.text.localeCompare(b.text))
}

// Dismissed items are hidden until `until` (a local date, exclusive of today's
// date being on/after it). Default is "not today".
export function visibleToday(items, snoozes, now = new Date()) {
  const today = localDate(now)
  return items.filter((i) => !(snoozes[i.id] && snoozes[i.id] > today))
}

export function snoozeUntil(item, now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (item.snoozeDays ?? 1))
  return localDate(d)
}
