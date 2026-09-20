import { AREAS, effectiveEvents, localDate } from '../core/events'
import { DOMAIN_MAP } from '../lib/domains'
import { deriveMoney, formatCents, toCents } from '../modules/money'

// Read-only summaries for the built-in trackers, computed from the entries.
// Nothing here is stored or written to the log, and none of it is medical
// advice: it is arithmetic on what was typed in, plus gentle wording.

const DAY = 86400000
const num = (v) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const round1 = (n) => Math.round(n * 10) / 10
const fmt = (n) => round1(n).toLocaleString('en-US', { maximumFractionDigits: 1 })
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`
const vals = (e) => e.data.values ?? {}
const dateOf = (e) => localDate(e.occurredAt)

function addDays(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return localDate(new Date(y, m - 1, d + delta))
}
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00`) - new Date(`${a}T00:00`)) / DAY)
const mondayOf = (dateStr) => {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return localDate(new Date(y, m - 1, d - ((dt.getDay() + 6) % 7)))
}
const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)
const shortDay = (dateStr) => new Date(`${dateStr}T00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

// The entries of one tracker, oldest first.
export function trackerEntries(events, trackerId) {
  return effectiveEvents(events).filter((e) => e.type === 'tracker.entry' && e.data.trackerId === trackerId)
}

// ---- Body -----------------------------------------------------------------

export function liftingVolume(entries, fromDate, toDate) {
  let total = 0
  for (const e of entries) {
    const d = dateOf(e)
    if (d < fromDate || d > toDate) continue
    const { sets, reps, weight } = vals(e)
    if (num(sets) && num(reps) && num(weight)) total += num(sets) * num(reps) * num(weight)
  }
  return total
}

function bodyBlocks(entries, now) {
  const today = localDate(now)
  const start = mondayOf(today)
  const prevStart = addDays(start, -7)
  const inWeek = entries.filter((e) => dateOf(e) >= start)
  const minutes = inWeek.reduce((s, e) => s + (num(vals(e).minutes) ?? 0), 0)
  const lines = [`This week: ${plural(inWeek.length, 'session')}, ${minutes} min.`]
  const vol = liftingVolume(entries, start, today)
  const prev = liftingVolume(entries, prevStart, addDays(start, -1))
  if (vol || prev) lines.push(`Lifting volume this week: ${vol.toLocaleString('en-US')} (sets × reps × weight)${prev ? `, last week ${prev.toLocaleString('en-US')}` : ''}.`)
  return [{ id: 'week', title: 'This week', lines }]
}

// ---- Health ---------------------------------------------------------------

export function weightTrend(entries, now) {
  const today = localDate(now)
  const pts = entries
    .filter((e) => vals(e).kind === 'weight' && num(vals(e).value) > 0)
    .map((e) => ({ date: dateOf(e), value: num(vals(e).value) }))
    .sort((a, b) => a.date.localeCompare(b.date))
  if (!pts.length) return null
  const latest = pts[pts.length - 1]
  const inRange = (from, to) => pts.filter((p) => p.date >= from && p.date <= to).map((p) => p.value)
  const thisWeek = avg(inRange(addDays(today, -6), today))
  const lastWeek = avg(inRange(addDays(today, -13), addDays(today, -7)))
  const month = pts.filter((p) => p.date >= addDays(today, -30))
  return {
    latest,
    weekAvg: thisWeek,
    weekChange: thisWeek !== null && lastWeek !== null ? thisWeek - lastWeek : null,
    monthChange: month.length >= 2 ? month[month.length - 1].value - month[0].value : null,
  }
}

export function dayNutrition(entries, date) {
  const t = { meals: 0, calories: 0, protein: 0, carbs: 0, fat: 0 }
  for (const e of entries) {
    const v = vals(e)
    if (v.kind !== 'meal' || dateOf(e) !== date) continue
    t.meals += 1
    t.calories += num(v.calories) ?? num(v.value) ?? 0
    t.protein += num(v.protein) ?? 0
    t.carbs += num(v.carbs) ?? 0
    t.fat += num(v.fat) ?? 0
  }
  return t
}

const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`

function healthBlocks(entries, now) {
  const today = localDate(now)
  const blocks = []
  const n = dayNutrition(entries, today)
  const todayLines = []
  if (n.meals) {
    const parts = [`${plural(n.meals, 'meal')}`]
    if (n.calories) parts.push(`${Math.round(n.calories).toLocaleString('en-US')} kcal`)
    if (n.protein) parts.push(`protein ${fmt(n.protein)} g`)
    if (n.carbs) parts.push(`carbs ${fmt(n.carbs)} g`)
    if (n.fat) parts.push(`fat ${fmt(n.fat)} g`)
    todayLines.push(`Today: ${parts.join(' · ')}.`)
  } else {
    todayLines.push('No meals logged today.')
  }
  const sleeps = entries.filter((e) => vals(e).kind === 'sleep' && num(vals(e).value) > 0 && dateOf(e) >= addDays(today, -6)).map((e) => num(vals(e).value))
  if (sleeps.length) todayLines.push(`Sleep, last 7 days: ${fmt(avg(sleeps))} h on average (${plural(sleeps.length, 'night')} logged).`)
  blocks.push({ id: 'today', title: 'Today', lines: todayLines })

  const w = weightTrend(entries, now)
  if (w) {
    const lines = [`Latest: ${fmt(w.latest.value)} (${shortDay(w.latest.date)}).`]
    if (w.weekAvg !== null) lines.push(`7-day average ${fmt(w.weekAvg)}${w.weekChange !== null ? `, ${signed(w.weekChange)} from the week before` : ''}.`)
    if (w.monthChange !== null) lines.push(`Past 30 days: ${signed(w.monthChange)}.`)
    blocks.push({ id: 'weight', title: 'Weight trend', lines })
  }
  return blocks
}

// ---- Mind -----------------------------------------------------------------

function mindBlocks(entries, now) {
  const today = localDate(now)
  const moods = entries.filter((e) => num(vals(e).mood) !== null).map((e) => ({ date: dateOf(e), mood: num(vals(e).mood) }))
  const blocks = []
  const cur = moods.filter((m) => m.date >= addDays(today, -6)).map((m) => m.mood)
  const prev = moods.filter((m) => m.date >= addDays(today, -13) && m.date <= addDays(today, -7)).map((m) => m.mood)
  if (cur.length) {
    blocks.push({
      id: 'mood',
      title: 'Mood',
      lines: [`Averaging ${fmt(avg(cur))} out of 5 over the last 7 days${prev.length ? ` (${fmt(avg(prev))} the week before)` : ''}.`],
      series: moods.slice(-14).map((m) => m.mood),
    })
  }
  const notes = []
  const last = entries.length ? dateOf(entries[entries.length - 1]) : null
  const recentMoods = moods.slice(-3).map((m) => m.mood)
  if (recentMoods.length === 3 && recentMoods.every((m) => m <= 2)) {
    notes.push("Your last few check-ins have been low. That's worth noticing, and it's okay. Talking with someone you trust, or a professional, can help.")
  } else if (!last || daysBetween(last, today) >= 3) {
    notes.push('It has been a few days. A check-in can be as small as one line. No pressure.')
  }
  if (notes.length) blocks.push({ id: 'checkin', title: 'A gentle nudge', lines: notes, tone: 'gentle' })
  return blocks
}

// ---- Learning: spaced review ---------------------------------------------

export const REVIEW_STEPS = [1, 3, 7, 14, 30, 60] // days after the last study or review

const itemKey = (v) => `${String(v.subject ?? '').trim().toLowerCase()}|${String(v.remember ?? '').trim().toLowerCase()}`

// Anything logged with a "remember" note becomes something to review at
// growing gaps. Each review logged (type = review, same subject and note)
// moves it to the next, longer gap. After the last gap it is done.
export function reviewQueue(entries, now = new Date()) {
  const today = localDate(now)
  const groups = new Map()
  for (const e of entries) {
    const v = vals(e)
    if (!String(v.remember ?? '').trim()) continue
    const key = itemKey(v)
    const g = groups.get(key) ?? { key, subject: v.subject, remember: v.remember, last: null, reviews: 0 }
    const d = dateOf(e)
    if (!g.last || d > g.last) g.last = d
    if (v.type === 'review') g.reviews += 1
    groups.set(key, g)
  }
  const queue = []
  for (const g of groups.values()) {
    if (g.reviews >= REVIEW_STEPS.length) continue
    const dueOn = addDays(g.last, REVIEW_STEPS[g.reviews])
    queue.push({ key: g.key, subject: g.subject, remember: g.remember, dueOn, step: g.reviews + 1, of: REVIEW_STEPS.length, overdueDays: Math.max(0, daysBetween(dueOn, today)), due: dueOn <= today })
  }
  return queue.sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.key.localeCompare(b.key))
}

function learningBlocks(entries, now) {
  const queue = reviewQueue(entries, now)
  const due = queue.filter((q) => q.due)
  const blocks = []
  if (due.length) {
    blocks.push({
      id: 'review',
      title: `Due for review (${due.length})`,
      lines: due.slice(0, 6).map((q) => `${q.subject}: ${q.remember}`),
      reviews: due.slice(0, 6),
    })
  } else if (queue.length) {
    blocks.push({ id: 'review', title: 'Review queue', lines: [`Nothing due. Next up: ${queue[0].subject} on ${shortDay(queue[0].dueOn)}.`] })
  }
  return blocks
}

// ---- Career and side hustles: pipelines ----------------------------------

function countBy(items, key) {
  const out = new Map()
  for (const it of items) out.set(it[key], (out.get(it[key]) ?? 0) + 1)
  return out
}

function careerBlocks(entries, now) {
  const latest = new Map()
  for (const e of entries) {
    const v = vals(e)
    if (!v.stage) continue
    latest.set(`${String(v.company ?? '').toLowerCase()}|${String(v.title ?? '').toLowerCase()}`, { stage: v.stage, company: v.company, title: v.title })
  }
  const blocks = []
  if (latest.size) {
    const order = ['applied', 'screening', 'interview', 'offer', 'accepted', 'rejected']
    const counts = countBy([...latest.values()], 'stage')
    blocks.push({ id: 'pipeline', title: 'Application pipeline', lines: [order.filter((s) => counts.has(s)).map((s) => `${counts.get(s)} ${s}`).join(' · ') + '.'] })
  }
  const year = localDate(now).slice(0, 4)
  const wins = entries.filter((e) => vals(e).kind === 'win' && dateOf(e).startsWith(year)).length
  if (wins) blocks.push({ id: 'wins', title: 'Wins', lines: [`${plural(wins, 'win')} logged this year.`] })
  return blocks
}

const incomeCentsOf = (v) => (num(v.income) !== null ? toCents(num(v.income)) : num(v.incomeCents) ?? 0)

// Money earned from side hustles, in cents, for a month ("2026-05") or all time.
export function sideIncomeCents(events, month = null) {
  return trackerEntries(events, 'hustles')
    .filter((e) => !month || localDate(e.occurredAt).startsWith(month))
    .reduce((s, e) => s + incomeCentsOf(vals(e)), 0)
}

function hustleBlocks(entries, now, events) {
  const blocks = []
  const latest = new Map()
  for (const e of entries) {
    const v = vals(e)
    if (v.idea && v.status) latest.set(String(v.idea).toLowerCase(), { idea: v.idea, status: v.status })
  }
  if (latest.size) {
    const order = ['idea', 'researching', 'started', 'earning']
    const counts = countBy([...latest.values()], 'status')
    blocks.push({ id: 'pipeline', title: 'Pipeline', lines: [order.filter((s) => counts.has(s)).map((s) => `${counts.get(s)} ${s}`).join(' · ') + '.'] })
  }
  const month = localDate(now).slice(0, 7)
  const total = sideIncomeCents(events)
  if (total) blocks.push({ id: 'income', title: 'Income', lines: [`This month ${formatCents(sideIncomeCents(events, month))} · all time ${formatCents(total)}.`] })
  return blocks
}

// ---- Travel: trips and what they cost ------------------------------------

export function tripSpending(events, now = new Date()) {
  const trips = new Map()
  for (const e of trackerEntries(events, 'travel')) {
    const v = vals(e)
    if (!v.trip) continue
    const key = String(v.trip).trim().toLowerCase()
    const t = trips.get(key) ?? { name: String(v.trip).trim(), budgetCents: null, entries: 0, spentCents: 0 }
    t.entries += 1
    if (num(v.budget) !== null) t.budgetCents = toCents(num(v.budget))
    trips.set(key, t)
  }
  let other = 0
  for (const p of deriveMoney(events, now).purchases) {
    if (!String(p.category).startsWith('travel')) continue
    const text = `${p.merchant ?? ''} ${p.note ?? ''} ${p.category}`.toLowerCase()
    const match = [...trips.entries()].find(([key]) => text.includes(key))
    if (match) match[1].spentCents += p.amountCents
    else other += p.amountCents
  }
  return { trips: [...trips.values()], otherCents: other }
}

function travelBlocks(entries, now, events) {
  const { trips, otherCents } = tripSpending(events, now)
  const lines = trips.map((t) => `${t.name}: ${formatCents(t.spentCents)} spent${t.budgetCents !== null ? ` of ${formatCents(t.budgetCents)} budget${t.spentCents > t.budgetCents ? ' (over)' : ''}` : ''}.`)
  if (otherCents) lines.push(`Other travel spending: ${formatCents(otherCents)}.`)
  if (!lines.length) return []
  lines.push('Spending comes from Money purchases in a "travel" category that mention the trip.')
  return [{ id: 'trips', title: 'Trips and spending', lines }]
}

// ---- Compass: the year in review -----------------------------------------

export function yearInReview(evState, year) {
  const byArea = {}
  const bySkill = new Map()
  const days = new Set()
  for (const entry of evState.entries) {
    if (!entry.createdAt.startsWith(String(year)) && localDate(entry.createdAt).slice(0, 4) !== String(year)) continue
    days.add(localDate(entry.createdAt))
    for (const u of entry.updates) {
      if (u.xpGain <= 0) continue
      byArea[u.domain] = (byArea[u.domain] ?? 0) + u.xpGain
      const k = `${u.domain}|${u.skillName}`
      bySkill.set(k, { area: u.domain, name: u.skillName, xp: (bySkill.get(k)?.xp ?? 0) + u.xpGain })
    }
  }
  const areas = AREAS.map((a) => ({ area: a, name: DOMAIN_MAP[a].name, xp: byArea[a] ?? 0 })).sort((a, b) => b.xp - a.xp)
  return {
    year,
    activeDays: days.size,
    totalXp: areas.reduce((s, a) => s + a.xp, 0),
    areas,
    quiet: areas.filter((a) => a.xp === 0).map((a) => a.name),
    topSkills: [...bySkill.values()].sort((a, b) => b.xp - a.xp).slice(0, 5),
  }
}

export const REVIEW_PROMPTS = [
  { id: 'well', label: 'What went well this year?' },
  { id: 'change', label: 'What do I want to change?' },
  { id: 'focus', label: 'What is my focus for next year?' },
]

// ---- Entry point ----------------------------------------------------------

const BUILDERS = {
  body: bodyBlocks,
  health: healthBlocks,
  mind: mindBlocks,
  learning: learningBlocks,
  career: careerBlocks,
  hustles: hustleBlocks,
  travel: travelBlocks,
}

export function trackerBlocks(trackerId, events, now = new Date()) {
  const build = BUILDERS[trackerId]
  if (!build) return []
  return build(trackerEntries(events, trackerId), now, events)
}
