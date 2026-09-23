import { localDate } from '@evergrove/core/events.js'
import { DOMAIN_MAP } from '@evergrove/core/lib/domains.js'
import { deriveEvergrove } from './derive.js'
import { listApps } from './registry.js'
import { formatCents } from '@evergrove/modules/money.js'

// The logic behind the log viewer (/log): summaries, filters, search, correction
// chains, growth explanations and exports. Pure functions of the events, so the
// screen stays thin and every rule here is tested. Nothing here writes to the log.

const MAX_EXPORT_TEXT = 200

// What the viewer needs to know about the current log: which apps are private,
// what each app is called, and what growth each event produced.
export function buildViewContext(events) {
  const apps = listApps(events)
  const names = new Map(apps.map((a) => [a.id, a.name]))
  names.set('jarvis', 'MOXIE')
  names.set('evergrove', 'Evergrove')
  names.set('memory', 'Memory')
  const priv = new Set(apps.filter((a) => a.sensitive).map((a) => a.id))
  priv.add('memory') // notes about you are personal: hidden in the viewer until you ask to see them
  const evState = deriveEvergrove(events)
  const growth = new Map(evState.entries.map((e) => [e.id, e.updates]))
  const trackers = new Map(evState.trackers.map((t) => [t.id, t]))
  return { names, priv, growth, trackers, corrections: analyzeCorrections(events) }
}

export const isPrivate = (e, ctx) => ctx.priv.has(e.app) || (e.type === 'command.executed' && ctx.priv.has(e.data?.module))

// ---- corrections -----------------------------------------------------------

// For every event: is it still counting, was it undone or replaced, and what
// undid it. A reversal is itself an event that can be reversed.
export function analyzeCorrections(events) {
  const byId = new Map(events.map((e) => [e.id, e]))
  const killers = new Map()
  for (const e of events) {
    if (!e.supersedes) continue
    if (!killers.has(e.supersedes)) killers.set(e.supersedes, [])
    killers.get(e.supersedes).push(e)
  }
  // An event counts unless something that itself counts supersedes it (reversals included).
  const memo = new Map()
  const visiting = new Set()
  const counts = (id) => {
    if (memo.has(id)) return memo.get(id)
    if (visiting.has(id)) return true
    visiting.add(id)
    const result = !(killers.get(id) ?? []).some((k) => byId.has(k.id) && counts(k.id))
    visiting.delete(id)
    memo.set(id, result)
    return result
  }
  const live = { has: (id) => counts(id) }
  const out = new Map()
  for (const e of events) {
    const by = killers.get(e.id) ?? []
    let status
    if (e.type === 'event.reversed') status = 'reversal'
    else if (live.has(e.id)) status = 'active'
    else status = by.some((k) => k.type === 'event.reversed' && live.has(k.id)) ? 'reversed' : 'replaced'
    out.set(e.id, { status, by: by.map((k) => k.id), target: e.supersedes ?? null })
  }
  return out
}

// ---- summaries -------------------------------------------------------------

const money = (cents) => formatCents(Number(cents) || 0)
const list = (values) => Object.values(values ?? {}).filter((v) => v !== '' && v !== undefined && v !== null).join(', ')

const SUMMARIES = {
  'skill.practiced': (d) => `Practiced ${d.skillName ?? d.skillId} (+${d.xp} xp)`,
  'skill.added': (d) => `Planted ${d.skillName}`,
  'tracker.entry': (d, e, ctx) => `${ctx.trackers.get(d.trackerId)?.name ?? d.trackerId}: ${list(d.values)}`,
  'tracker.defined': (d) => `Made a tracker: ${d.name ?? d.trackerId}`,
  'task.created': (d) => `Task: ${d.title}${d.repeatEveryDays ? ` (repeats every ${d.repeatEveryDays} days)` : ''}`,
  'task.completed': (d) => `Done: ${d.title}`,
  'task.deleted': () => 'Deleted a task',
  'habit.defined': (d) => `Habit: ${d.name}`,
  'habit.checked': (d) => `Checked a habit for ${d.date}`,
  'habit.archived': () => 'Archived a habit',
  'goal.created': (d) => `Goal: ${d.title}`,
  'goal.milestone.added': (d) => `Milestone added: ${d.text}`,
  'goal.milestone.done': (d) => `Milestone done: ${d.text}`,
  'goal.completed': () => 'Goal achieved',
  'goal.dropped': () => 'Goal dropped',
  'calendar.event.created': (d) => `Event: ${d.title}, ${d.start}${d.repeat ? ` (repeats ${d.repeat})` : ''}`,
  'calendar.event.rescheduled': (d) => `Moved an event to ${d.start}`,
  'calendar.event.cancelled': () => 'Cancelled an event',
  'calendar.event.skipped': (d) => `Skipped an event on ${d.date}`,
  'money.purchase.logged': (d) => `${money(d.amountCents)} ${d.category}${d.merchant ? ` at ${d.merchant}` : ''}`,
  'money.bill.defined': (d) => `Bill: ${d.name} ${d.amountCents ? money(d.amountCents) : ''}`.trim(),
  'money.bill.paid': (d) => `Paid: ${d.name}`,
  'money.bill.archived': () => 'Stopped tracking a bill',
  'money.bill.flagged': (d) => (d.flagged ? 'Marked a bill as a cancel candidate' : 'Cleared a cancel mark'),
  'money.budget.set': (d) => `Budget ${d.category}: ${money(d.monthlyCents)} a month`,
  'money.goal.set': (d) => `Savings goal: ${d.name}`,
  'money.goal.contributed': (d) => `Saved ${money(d.amountCents)}`,
  'money.account.balance': (d) => `${d.name}: ${money(d.balanceCents)}`,
  'money.holding.set': (d) => `${d.name}: ${money(d.valueCents)}`,
  'money.holding.removed': () => 'Stopped tracking an investment',
  'money.month.closed': (d) => `Closed ${d.month}${d.withinBudget ? ' within budget' : ''}`,
  'people.person.saved': (d) => `Saved ${d.name}`,
  'people.contact.logged': (d) => d.text ?? 'Stayed in touch',
  'vault.item.saved': (d) => `Saved "${d.title}" (contents stay encrypted)`,
  'vault.item.deleted': () => 'Removed a vault item',
  'security.checked': (d) => `Security checklist: ${d.itemId} ${d.checked ? 'ticked' : 'unticked'}`,
  'area.paused': (d) => `Paused ${DOMAIN_MAP[d.area]?.name ?? d.area}`,
  'area.resumed': (d) => `Resumed ${DOMAIN_MAP[d.area]?.name ?? d.area}`,
  'tree.named': (d) => `Named the tree "${d.name}"`,
  'app.requested': (d) => `App idea: ${d.name}`,
  'command.executed': (d) => d.summary || `Ran ${d.tool}`,
  'event.reversed': () => 'Undid an earlier entry',
  'memory.noted': (d) => `Remembered: ${d.text}`,
  'memory.revised': () => 'Changed a memory',
  'memory.forgotten': () => 'Forgot a memory',
  'weekly.polished': () => 'MOXIE put the week into words',
  'note.shown': (d) => `MOXIE mentioned: ${d.obsId}`,
  'feedback.given': (d) => `Feedback: ${d.value}`,
}

// One line describing an event. Private events show only "<App> entry (private)"
// unless the caller says private contents may be shown.
export function summarize(e, ctx, { showPrivate = false } = {}) {
  if (isPrivate(e, ctx) && !showPrivate) return `${ctx.names.get(e.app) ?? e.app} entry (private)`
  const fn = SUMMARIES[e.type]
  try {
    const text = fn ? fn(e.data ?? {}, e, ctx) : e.type
    return String(text).slice(0, MAX_EXPORT_TEXT)
  } catch {
    return e.type
  }
}

// ---- filtering and search --------------------------------------------------

const searchCache = new WeakMap()
function haystack(e, ctx, showPrivate) {
  const key = showPrivate ? 1 : 0
  let entry = searchCache.get(e)
  if (!entry) searchCache.set(e, (entry = {}))
  entry[key] ??= [e.type, e.app, e.actor, summarize(e, ctx, { showPrivate }), showPrivate || !isPrivate(e, ctx) ? JSON.stringify(e.data ?? {}) : ''].join(' ').toLowerCase()
  return entry[key]
}

const newestFirst = (a, b) =>
  a.occurredAt !== b.occurredAt ? (a.occurredAt < b.occurredAt ? 1 : -1) : a.recordedAt !== b.recordedAt ? (a.recordedAt < b.recordedAt ? 1 : -1) : a.id < b.id ? 1 : -1

// filters: { apps, types, areas, actors, from, to, query, showPrivate }
// All optional. `from` and `to` are local dates (YYYY-MM-DD), inclusive.
export function filterEvents(events, filters = {}, ctx) {
  const { apps, types, areas, actors, from, to, query, showPrivate = false } = filters
  const q = String(query ?? '').trim().toLowerCase()
  const out = events.filter((e) => {
    if (apps?.length && !apps.includes(e.app)) return false
    if (types?.length && !types.includes(e.type)) return false
    if (areas?.length && !areas.includes(e.area)) return false
    if (actors?.length && !actors.includes(e.actor)) return false
    if (from || to) {
      const day = localDate(e.occurredAt)
      if (from && day < from) return false
      if (to && day > to) return false
    }
    if (q && !haystack(e, ctx, showPrivate).includes(q)) return false
    return true
  })
  return out.sort(newestFirst)
}

// ---- explaining and stats --------------------------------------------------

// "Why did this grow": the growth this event produced, or an empty list.
export function growthLines(e, ctx) {
  return (ctx.growth.get(e.id) ?? [])
    .filter((u) => u.xpGain > 0)
    .map((u) => `+${u.xpGain} xp ${u.skillName} (${DOMAIN_MAP[u.domain]?.name ?? u.domain})`)
}

export function logStats(events) {
  if (!events.length) return { count: 0, first: null, last: null, corrections: 0 }
  let first = events[0].occurredAt
  let last = events[0].occurredAt
  let corrections = 0
  for (const e of events) {
    if (e.occurredAt < first) first = e.occurredAt
    if (e.occurredAt > last) last = e.occurredAt
    if (e.type === 'event.reversed' || e.supersedes) corrections++
  }
  return { count: events.length, first: localDate(first), last: localDate(last), corrections }
}

export function deviceLabel(e) {
  return e.device ? `device ${e.device}` : 'earlier (before devices were recorded)'
}

// The lists a filter bar offers, taken from what is actually in the log.
export function filterChoices(events) {
  const apps = new Set()
  const types = new Set()
  const actors = new Set()
  for (const e of events) {
    apps.add(e.app)
    types.add(e.type)
    actors.add(e.actor)
  }
  return { apps: [...apps].sort(), types: [...types].sort(), actors: [...actors].sort() }
}

// ---- export ----------------------------------------------------------------

export const csvCell = (v) => {
  const s = String(v ?? '')
  // A cell that starts with a formula character could run as one in a spreadsheet: neutralise it.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

// JSON of the events as stored. Private contents are replaced unless showPrivate is set.
export function exportJson(events, ctx, { showPrivate = false } = {}) {
  const rows = events.map((e) => (isPrivate(e, ctx) && !showPrivate ? { ...e, data: { private: true } } : e))
  return JSON.stringify(rows, null, 2)
}

export function exportCsv(events, ctx, { showPrivate = false } = {}) {
  const header = ['time', 'app', 'type', 'area', 'actor', 'device', 'status', 'summary']
  const lines = [header.join(',')]
  for (const e of events) {
    const row = [e.occurredAt, e.app, e.type, e.area ?? '', e.actor, e.device ?? '', ctx.corrections.get(e.id)?.status ?? '', summarize(e, ctx, { showPrivate })]
    lines.push(row.map(csvCell).join(','))
  }
  return lines.join('\n')
}
