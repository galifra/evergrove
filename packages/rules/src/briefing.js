import { localDate } from '@evergrove/core/events.js'
import { deriveEvergrove } from './derive'
import { deriveCalendar, expandCalendar } from '@evergrove/modules/calendar.js'
import { deriveTasks } from '@evergrove/modules/tasks.js'
import { deriveMoney, formatCents } from '@evergrove/modules/money.js'
import { derivePeople } from '@evergrove/modules/people.js'
import { briefingNote } from './observations.js'
import { weeklyReadyLine } from './weekly.js'

// The evening briefing: what tomorrow holds, in a few short lines. Built on the
// device from the device's own data, both for the push notification (by the
// service worker) and for MOXIE's "brief me" message. Pure, so it is tested
// without a browser.

export const DEFAULT_BRIEFING_PREFS = { detail: 'full', showAmounts: false, speakUp: 'necessary' }

const MAX_LINES = 5
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`

function addDays(now, n) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + n)
}

function shortDate(d) {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function clock(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return new Date(2000, 0, 1, h, m).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function composeBriefing(events, now = new Date(), prefs = DEFAULT_BRIEFING_PREFS) {
  const p = { ...DEFAULT_BRIEFING_PREFS, ...prefs }
  const tomorrowDate = addDays(now, 1)
  const today = localDate(now)
  const tomorrow = localDate(tomorrowDate)

  const calendar = expandCalendar(deriveCalendar(events), tomorrow, tomorrow)
  const tasks = deriveTasks(events, now).open
  const dueTasks = tasks.filter((t) => t.due === tomorrow)
  const overdueTasks = tasks.filter((t) => t.due && t.due < tomorrow && t.due !== tomorrow)
  const money = deriveMoney(events, now)
  const dueBills = money.bills.filter((b) => !b.paid && !b.overdue && b.dueOn === tomorrow)
  const overdueBills = money.bills.filter((b) => !b.paid && b.overdue)
  const birthdays = derivePeople(events, now).people.filter((x) => x.nextBirthday?.date === tomorrow)
  const loggedToday = deriveEvergrove(events).growthDays.has(today)

  const counts = {
    events: calendar.length,
    tasks: dueTasks.length,
    bills: dueBills.length,
    birthdays: birthdays.length,
    overdue: overdueTasks.length + overdueBills.length,
  }
  const total = counts.events + counts.tasks + counts.bills + counts.birthdays
  const title = `Tomorrow · ${shortDate(tomorrowDate)}`

  let lines = []
  if (p.detail === 'counts') {
    const parts = []
    if (counts.events) parts.push(plural(counts.events, 'event'))
    if (counts.tasks) parts.push(plural(counts.tasks, 'task') + ' due')
    if (counts.bills) parts.push(plural(counts.bills, 'bill') + ' due')
    if (counts.birthdays) parts.push(plural(counts.birthdays, 'birthday'))
    lines.push(parts.length ? `${parts.join(', ')}.` : 'Nothing scheduled.')
    if (counts.overdue) lines.push(`${plural(counts.overdue, 'overdue item')}.`)
  } else {
    const detail = []
    for (const e of calendar) detail.push(e.allDay ? `${e.title} (all day)` : `${clock(e.start.slice(11))} ${e.title}`)
    for (const t of dueTasks) detail.push(`Due: ${t.title}`)
    for (const b of dueBills) detail.push(`${b.name}${p.showAmounts && b.amountCents ? ` ${formatCents(b.amountCents)}` : ''} is due`)
    for (const x of birthdays) detail.push(`${x.name}'s birthday`)
    if (!detail.length) detail.push('Nothing scheduled.')
    if (detail.length > MAX_LINES) {
      const extra = detail.length - (MAX_LINES - 1)
      detail.splice(MAX_LINES - 1, extra, `...and ${extra} more`)
    }
    lines = detail
    if (counts.overdue) lines.push(`${plural(counts.overdue, 'overdue item')} waiting.`)
  }
  if (!loggedToday) lines.push("You haven't logged anything today.")

  // MOXIE's note: one line, generic if it is about something private, and nothing at all if he is set to never speak up.
  let note = null
  if (p.speakUp !== 'never') {
    note = briefingNote(events, now, { speakUp: p.speakUp })
    if (note) lines.push(`MOXIE's note: ${note.text}`)
    const weekly = weeklyReadyLine(now)
    if (weekly) lines.push(weekly)
  }

  return { title, lines, body: lines.join('\n'), counts, total, loggedToday, tomorrow, note }
}
