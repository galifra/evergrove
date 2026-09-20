import { effectiveEvents, localDate } from '@evergrove/core/events.js'
import { AREAS } from '@evergrove/core/events.js'
import { DOMAIN_MAP } from '@evergrove/core/lib/domains.js'
import { deriveEvergrove } from './derive.js'
import { observe, wording } from './observations.js'

// The weekly review (docs/v2/FEEDBACK-SPEC.md): built on the device from templates for the last
// full week, Monday to Sunday. What grew, what stalled, wins, one suggestion, one question. It
// makes no AI call and reads nothing but your own data, so building it twice from the same data
// gives the same review, word for word.

const DAY = 86400000
const dayNumber = (date) => {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / DAY
}
const addDays = (date, n) => {
  const [y, m, d] = date.split('-').map(Number)
  return localDate(new Date(y, m - 1, d + n))
}
const areaName = (a) => DOMAIN_MAP[a]?.name ?? a
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`
const short = (date) => new Date(`${date}T00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const listOf = (items) => (items.length <= 2 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`)

// One question a week, from a fixed list, rotating by week so it changes.
export const QUESTIONS = [
  'What is one thing from this week you would like to repeat?',
  'What got in the way most this week?',
  'Is there something on the list that no longer belongs there?',
  'What would make next week feel like a good week?',
  'Which area do you want to give a little more to?',
  'What are you proudest of from the last seven days?',
]

// The week that counts: the one ending on the latest Sunday, today included, so it is complete
// by Sunday evening when the briefing says it is ready.
export function weekRange(now = new Date()) {
  const today = localDate(now)
  const to = addDays(today, -now.getDay()) // getDay() is 0 on Sunday
  return { from: addDays(to, -6), to }
}

const isoWeek = (date) => Math.floor(dayNumber(date) / 7)

export function composeWeekly(events, now = new Date()) {
  const { from, to } = weekRange(now)
  const inWeek = (iso) => {
    const d = localDate(iso)
    return d >= from && d <= to
  }
  const evState = deriveEvergrove(events)
  const paused = new Set(evState.paused)

  // what grew
  const byArea = {}
  const bySkill = new Map()
  const days = new Set()
  for (const entry of evState.entries) {
    if (!inWeek(entry.createdAt)) continue
    for (const u of entry.updates) {
      if (!(u.xpGain > 0)) continue
      byArea[u.domain] = (byArea[u.domain] ?? 0) + u.xpGain
      const k = `${u.domain}:${u.skillId}`
      const priv = !!evState.skills[u.domain]?.[u.skillId]?.private
      const row = bySkill.get(k) ?? { area: u.domain, name: priv ? areaName(u.domain) : u.skillName, private: priv, xp: 0 }
      row.xp += u.xpGain
      bySkill.set(k, row)
      days.add(localDate(entry.createdAt))
    }
  }
  const grewAreas = Object.entries(byArea)
    .map(([area, xp]) => ({ area, name: areaName(area), xp }))
    .sort((a, b) => b.xp - a.xp || a.name.localeCompare(b.name))
  const topSkills = [...bySkill.values()].sort((a, b) => b.xp - a.xp || a.name.localeCompare(b.name)).slice(0, 3)
  const totalXp = grewAreas.reduce((s, a) => s + a.xp, 0)

  let tasksDone = 0
  let habitChecks = 0
  for (const e of effectiveEvents(events)) {
    if (e.type === 'task.completed' && inWeek(e.occurredAt)) tasksDone += 1
    else if (e.type === 'habit.checked' && e.data.date >= from && e.data.date <= to) habitChecks += 1
  }

  // what stalled: an unpaused area that has skills but nothing this week, and habits that dipped
  const stalledAreas = AREAS.filter((a) => !paused.has(a) && Object.keys(evState.skills[a] ?? {}).length && !byArea[a]).map((a) => ({ area: a, name: areaName(a) }))
  const endOfWeek = new Date(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)), 20, 0)
  const asOfEnd = observe(events, endOfWeek, { winDays: 6 })
  const dips = asOfEnd.filter((o) => o.obsId === 'habit.dip').map((o) => o.params.name)
  // wins from anywhere in the week (a win is dated by when it happened)
  const wins = asOfEnd.filter((o) => o.cls === 'W')

  // one suggestion: the most urgent open thing as of now, which may be a bill, so it is in the app only
  const open = observe(events, now).filter((o) => o.cls !== 'W')
  const top = open[0] ?? null
  const question = QUESTIONS[isoWeek(from) % QUESTIONS.length]

  const sections = []
  sections.push({
    id: 'grew',
    title: 'What grew',
    lines: grewAreas.length
      ? [
          `${listOf(grewAreas.slice(0, 3).map((a) => `${a.name} (${a.xp} xp)`))}${grewAreas.length > 3 ? `, and ${plural(grewAreas.length - 3, 'more area')}` : ''}.`,
          `Most of it came from ${listOf(topSkills.map((s) => s.name))}.`,
          `You grew on ${days.size} of 7 days${tasksDone || habitChecks ? `, finished ${plural(tasksDone, 'task')} and ticked ${plural(habitChecks, 'habit check')}` : ''}.`,
        ]
      : ['Nothing grew this week, and that is allowed.'],
  })
  const stalled = []
  if (stalledAreas.length) stalled.push(`Quiet this week: ${listOf(stalledAreas.map((a) => a.name))}.`)
  if (dips.length) stalled.push(`${listOf(dips)} slipped compared with the weeks before.`)
  sections.push({ id: 'stalled', title: 'What stalled', lines: stalled.length ? stalled : ['Nothing stalled that I can see.'] })
  const winLinesFor = (list) => {
    // First-in-an-area wins are folded into one line, and the list is kept short.
    const firsts = list.filter((w) => w.obsId === 'win.first')
    const rest = list.filter((w) => w.obsId !== 'win.first').map((w) => wording(w, 0))
    const folded = firsts.length > 1 ? [`First growth this week in ${listOf(firsts.map((w) => w.params.area))}. Everything grows from there.`] : firsts.map((w) => wording(w, 0))
    return [...rest, ...folded].slice(0, 5)
  }
  sections.push({ id: 'wins', title: 'Wins', lines: wins.length ? winLinesFor(wins) : ['No big wins this week, only steady ones, if any.'] })
  sections.push({ id: 'suggestion', title: 'One suggestion', lines: [top ? wording(top, 0) : 'Nothing needs you right now. Keep going as you are.'] })
  sections.push({ id: 'question', title: 'One question', lines: [question] })

  const title = `Week of ${short(from)} to ${short(to)}`
  const text = [title, ...sections.flatMap((s) => [`${s.title}:`, ...s.lines])].join('\n')

  // What may be sent for an optional AI polish: the same review, without anything private.
  const publicWins = winLinesFor(wins.filter((w) => !w.private))
  const winLines = [...publicWins, ...(wins.some((w) => w.private) ? ['A win in a private area.'] : [])]
  const aiSections = sections.map((sec) => {
    if (sec.id === 'wins') return { ...sec, lines: winLines.length ? winLines : ['No big wins this week.'] }
    if (sec.id === 'suggestion' && top?.private) return { ...sec, lines: ['Something in a private area is worth a look.'] }
    return sec
  })
  const aiText = [title, ...aiSections.flatMap((s) => [`${s.title}:`, ...s.lines])].join('\n')

  return {
    range: { from, to },
    title,
    sections,
    text,
    aiText,
    facts: { totalXp, activeDays: days.size, tasksDone, habitChecks, areas: grewAreas.length },
    suggestion: top ? { obsId: top.obsId, key: top.key, cta: top.cta ?? null, private: top.private } : null,
    question,
  }
}

// On Sundays, from evening, the briefing says the review is ready.
export const weeklyReadyLine = (now = new Date()) => (now.getDay() === 0 ? 'Your weekly review is ready in Jarvis.' : null)
