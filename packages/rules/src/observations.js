import { AREAS, effectiveEvents, localDate } from '@evergrove/core/events.js'
import { DOMAIN_MAP } from '@evergrove/core/lib/domains.js'
import { levelFromXp } from '@evergrove/core/lib/treeEngine.js'
import { deriveCalendar, expandCalendar, overlaps } from '@evergrove/modules/calendar.js'
import { deriveGoals } from '@evergrove/modules/goals.js'
import { deriveMoney } from '@evergrove/modules/money.js'
import { deriveTasks } from '@evergrove/modules/tasks.js'
import { deriveEvergrove } from './derive.js'
import { reviewQueue, trackerEntries } from './trackerViews.js'

// What Jarvis notices (docs/v2/FEEDBACK-SPEC.md). Every observation is a pure function of your
// own data: it has an id, a priority, a privacy class and three wordings. Nothing here calls the
// AI, writes to the log or reads the clock except through `now`, so the same data always gives the
// same notes. Choosing which of them to show (limits, cooldowns, quiet hours, muting) is
// `chooseNotes`; what the person said about them is read back from `feedback.given` events.

const DAY = 86400000

// ---- the catalog ---------------------------------------------------------------

// cls: T time-sensitive, P pattern, W win. cooldown is in days per key ("once" = never again).
export const CATALOG = {
  'bill.overdue': { cls: 'T', priority: 1, private: true, cooldown: 1 },
  'bill.soon': { cls: 'T', priority: 2, private: true, cooldown: 1 },
  'deadline.soon': { cls: 'T', priority: 2, private: true, cooldown: 1 },
  'event.clash': { cls: 'T', priority: 2, private: false, cooldown: 2 },
  'task.overdue': { cls: 'T', priority: 3, private: false, cooldown: 3 },
  'streak.risk': { cls: 'P', priority: 3, private: false, cooldown: 1 },
  'goal.stalled': { cls: 'P', priority: 3, private: false, cooldown: 10 },
  'budget.over': { cls: 'P', priority: 3, private: true, cooldown: 30 },
  'review.overflow': { cls: 'T', priority: 4, private: false, cooldown: 3 },
  'area.silent': { cls: 'P', priority: 4, private: false, cooldown: 14 },
  'habit.dip': { cls: 'P', priority: 4, private: false, cooldown: 7 },
  'focus.skew': { cls: 'P', priority: 5, private: false, cooldown: 21 },
  'win.level': { cls: 'W', priority: 5, private: false, cooldown: 'once' },
  'win.streak': { cls: 'W', priority: 5, private: false, cooldown: 'once' },
  'win.goal': { cls: 'W', priority: 5, private: false, cooldown: 'once' },
  'win.first': { cls: 'W', priority: 6, private: false, cooldown: 'once' },
}

const ONCE = 36500
export const MUTE_DAYS = 30
export const QUIET = { from: 22, to: 7 }

// How each setting limits what is shown (spec: "Limits").
export const SPEAK_UP = {
  necessary: { maxPriority: 4, perDay: 2 },
  often: { maxPriority: 6, perDay: 4 },
  never: { maxPriority: 0, perDay: 0 },
}
export const SPEAK_UP_LABELS = { necessary: 'Only when necessary', often: 'More often', never: 'Never' }

// Three wordings each, chosen by a rotation on how often that kind was shown before, so he does
// not say the same thing twice in a row. Short, plain, no emoji, no exclamation marks, and an
// offer rather than a scolding. They never repeat a Today line word for word.
const s = (n) => (n === 1 ? '' : 's')
const WORDINGS = {
  'bill.overdue': [
    (p) => `${p.name} slipped ${p.days} day${s(p.days)} past due. Shall we open Money and settle it?`,
    (p) => `${p.name} is still unpaid and ${p.days} day${s(p.days)} late. Want to mark it paid, or move the date?`,
    (p) => `A quick flag: ${p.name} is ${p.days} day${s(p.days)} overdue. Money has the details.`,
  ],
  'bill.soon': [
    (p) => `${p.name} comes due ${p.when}. Want me to point you to Money so it's not a scramble?`,
    (p) => `Heads up, ${p.name} lands ${p.when}. Money has it ready to mark paid.`,
    (p) => `${p.name} is ${p.when === 'today' ? 'due today' : `about to come due (${p.when})`}. Worth a look while you think of it.`,
  ],
  'deadline.soon': [
    (p) => `${p.name} is ${p.when === 'today' ? 'due today' : `due ${p.when}`}. This is one worth sorting before it sorts you.`,
    (p) => `${p.name} arrives ${p.when}. Shall we open Money and deal with it?`,
    (p) => `Worth knowing: ${p.name} is ${p.when === 'today' ? 'today' : p.when}. Money has the details.`,
  ],
  'event.clash': [
    (p) => `${p.a} and ${p.b} overlap on ${p.day}. Want to move one?`,
    (p) => `You've got ${p.a} and ${p.b} at the same time on ${p.day}. One of them will have to give.`,
    (p) => `Two things collide on ${p.day}: ${p.a} and ${p.b}. Calendar can move either one.`,
  ],
  'task.overdue': [
    (p) => `"${p.title}" has been waiting ${p.days} days. Still worth doing, or shall we drop it?`,
    (p) => `"${p.title}" is ${p.days} days late now. Want a new date, or off the list?`,
    (p) => `That one about "${p.title}" is ${p.days} days behind. Do it, move it or bin it; any of the three is fine.`,
  ],
  'streak.risk': [
    (p) => `Your ${p.days}-day run of ${p.name} is still open today. A minute would keep it alive.`,
    (p) => `${p.name} hasn't been ticked yet, and ${p.days} days is worth protecting.`,
    (p) => `Evening check: ${p.name} is the only thing between you and day ${p.days + 1}.`,
  ],
  'goal.stalled': [
    (p) => `"${p.title}" hasn't moved in ${p.days} days. Want me to split it into smaller steps?`,
    (p) => `It's been ${p.days} days on "${p.title}". Big goals stall when the next step is fuzzy. Shall I break it down?`,
    (p) => `"${p.title}" looks stuck at ${p.days} days. I can turn it into a few small tasks if you like.`,
  ],
  'budget.over': [
    (p) => `${p.category} is over budget for the second month running. Worth a look at the number, or the limit.`,
    (p) => `${p.category} has gone past its limit two months in a row. Either the spending or the budget wants adjusting.`,
    (p) => `Two months over on ${p.category}. Money can show you where it went.`,
  ],
  'review.overflow': [
    (p) => `${p.count} reviews are stacked up. A short pass through a few would clear the pile.`,
    (p) => `Your review queue has grown to ${p.count}. Ten minutes now beats an hour later.`,
    (p) => `${p.count} things are due for review. Want to take the first handful?`,
  ],
  'area.silent': [
    (p) => `${p.area} has been quiet for ${p.days} days. Nothing wrong with that, just noting it.`,
    (p) => `I haven't seen anything in ${p.area} for ${p.days} days. Pause it, or nudge it?`,
    (p) => `${p.area} has gone still for ${p.days} days. Do you want to start small there, or leave it be?`,
  ],
  'habit.dip': [
    (p) => `${p.name} has dropped off this week: ${p.recent} of the last 7 days, against about ${p.usual} a week before. What changed?`,
    (p) => `You'd been steady with ${p.name}, and this week only ${p.recent} of 7. Should we make it easier?`,
    (p) => `${p.name} took a dip: ${p.recent} of 7 lately. It's worth asking whether it still fits.`,
  ],
  'focus.skew': [
    (p) => `Nearly all your growth this month is ${p.area}. That's fine if it's on purpose, and worth a thought if it isn't.`,
    (p) => `${p.percent}% of the last month went into ${p.area}, and ${p.silent} areas sat still. Balance is your call.`,
    (p) => `It's been mostly ${p.area} lately, with ${p.silent} areas untouched. Intentional?`,
  ],
  'win.level': [
    (p) => `${p.skill} just reached level ${p.level}. That one is earned.`,
    (p) => `Level ${p.level} in ${p.skill}. Well done.`,
    (p) => `${p.skill} hit level ${p.level}. Steady work shows.`,
  ],
  'win.streak': [
    (p) => `${p.days} days running on ${p.name}. That's a real habit now.`,
    (p) => `${p.name} is at ${p.days} days straight. Worth pausing to notice.`,
    (p) => `A ${p.days}-day streak on ${p.name}. Nicely done.`,
  ],
  'win.goal': [
    (p) => (p.done ? `"${p.title}" is finished. Well done.` : `You finished a milestone on "${p.title}": ${p.milestone}. That's real progress.`),
    (p) => (p.done ? `That's "${p.title}" complete. Take a moment with it.` : `"${p.milestone}" is ticked off on "${p.title}". Good.`),
    (p) => (p.done ? `"${p.title}" done and dusted.` : `One more step towards "${p.title}": ${p.milestone}.`),
  ],
  'win.first': [
    (p) => `First growth in ${p.area}. Everything grows from here.`,
    (p) => `${p.area} has its first entry. A good start.`,
    (p) => `You've planted something in ${p.area} for the first time.`,
  ],
}

// A private observation says only this when it leaves the app (a notification).
const GENERIC = {
  'bill.overdue': 'Something in Money needs your attention.',
  'bill.soon': 'Something in Money is coming due.',
  'deadline.soon': 'A deadline in Money is close.',
  'budget.over': 'Money has a budget worth a look.',
}

// ---- small helpers -------------------------------------------------------------

const dayNumber = (date) => {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / DAY
}
const daysBetween = (a, b) => Math.round(dayNumber(b) - dayNumber(a)) // b - a
const addDays = (date, n) => {
  const [y, m, d] = date.split('-').map(Number)
  return localDate(new Date(y, m - 1, d + n))
}
const areaName = (a) => DOMAIN_MAP[a]?.name ?? a
const whenWord = (n) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`)
const dayWord = (date) => new Date(`${date}T00:00`).toLocaleDateString('en-US', { weekday: 'long' })
const monthPrev = (month) => {
  const [y, m] = month.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

// ---- what the person said about them --------------------------------------------

export function feedbackState(events, now = new Date()) {
  const shown = [] // { obsId, key, date }
  const muted = new Map() // obsId -> local date the mute began
  const ratings = []
  for (const e of effectiveEvents(events)) {
    if (e.type === 'note.shown') shown.push({ obsId: e.data.obsId, key: e.data.key, date: e.data.date ?? localDate(e.occurredAt) })
    else if (e.type === 'feedback.given') {
      const d = e.data
      ratings.push({ ...d, at: e.occurredAt, id: e.id })
      if (d.targetKind !== 'note') continue
      if (d.value === 'not_useful') muted.set(d.targetId, localDate(e.occurredAt))
      else if (d.value === 'unmuted') muted.delete(d.targetId)
    }
  }
  const today = localDate(now)
  const active = [...muted.entries()].filter(([, since]) => daysBetween(since, today) < MUTE_DAYS).map(([obsId, since]) => ({ obsId, since, until: addDays(since, MUTE_DAYS) }))
  return { shown, muted: active, mutedIds: new Set(active.map((m) => m.obsId)), ratings }
}

// ---- the observations ----------------------------------------------------------

function habitHistory(events) {
  const habits = new Map()
  for (const e of effectiveEvents(events)) {
    if (e.type === 'habit.defined') habits.set(e.data.habitId, { definedOn: localDate(e.occurredAt), checks: new Set() })
    else if (e.type === 'habit.checked') habits.get(e.data.habitId)?.checks.add(e.data.date)
  }
  return habits
}

function goalProgressAt(events) {
  const created = new Map()
  const last = new Map()
  const bump = (id, iso) => {
    if (!last.has(id) || iso > last.get(id)) last.set(id, iso)
  }
  const taskGoal = new Map()
  const wins = []
  for (const e of effectiveEvents(events)) {
    const d = e.data
    if (e.type === 'goal.created') {
      created.set(d.goalId, e.occurredAt)
      bump(d.goalId, e.occurredAt)
    } else if (e.type === 'goal.milestone.added') bump(d.goalId, e.occurredAt)
    else if (e.type === 'goal.milestone.done') {
      bump(d.goalId, e.occurredAt)
      wins.push({ goalId: d.goalId, milestoneId: d.milestoneId, at: e.occurredAt, done: false })
    } else if (e.type === 'goal.completed') wins.push({ goalId: d.goalId, at: e.occurredAt, done: true })
    else if (e.type === 'task.created' && d.goalId) taskGoal.set(d.taskId, d.goalId)
    else if (e.type === 'task.completed' && taskGoal.has(d.taskId)) bump(taskGoal.get(d.taskId), e.occurredAt)
  }
  return { created, last, wins }
}

// Level-ups by skill, oldest first, so a win can be dated: [{ area, skillId, name, level, at, private }].
function levelUps(evState) {
  const totals = new Map()
  const out = []
  for (const entry of [...evState.entries].reverse()) {
    for (const u of entry.updates) {
      if (!(u.xpGain > 0)) continue
      const k = `${u.domain}:${u.skillId}`
      const before = levelFromXp(totals.get(k) ?? 0).level
      const total = (totals.get(k) ?? 0) + u.xpGain
      totals.set(k, total)
      const after = levelFromXp(total).level
      // Every level that is a multiple of five and was passed by this entry.
      for (let l = before + 1; l <= after; l++) {
        if (l % 5 === 0) out.push({ area: u.domain, skillId: u.skillId, name: u.skillName, level: l, at: entry.createdAt, private: !!evState.skills[u.domain]?.[u.skillId]?.private })
      }
    }
  }
  return out
}

/**
 * Everything worth saying right now, whether or not it is allowed to be said yet.
 * @returns {Array<{key, obsId, priority, cls, private, area, params, cta, coach}>}
 */
export function observe(events, now = new Date(), { winDays = 2 } = {}) {
  const today = localDate(now)
  const hour = now.getHours()
  const evState = deriveEvergrove(events)
  const paused = new Set(evState.paused)
  const out = []
  const push = (obsId, key, params, extra = {}) => out.push({ key, obsId, ...CATALOG[obsId], params, ...extra })
  const recent = (iso) => daysBetween(localDate(iso), today) <= winDays && daysBetween(localDate(iso), today) >= 0

  // bills and deadlines
  const money = deriveMoney(events, now)
  for (const b of money.bills) {
    if (b.paid) continue
    const cta = { label: 'Open Money', route: '/money' }
    if (b.overdue) push('bill.overdue', `bill.overdue:${b.id}:${b.period}`, { name: b.name, days: Math.max(1, daysBetween(b.dueOn, today)) }, { cta })
    else if (b.daysUntil <= 3) {
      const id = b.isDeadline ? 'deadline.soon' : 'bill.soon'
      push(id, `${id}:${b.id}:${b.period}`, { name: b.name, when: whenWord(b.daysUntil) }, { cta })
    }
  }

  // event clashes in the next 7 days
  const cal = deriveCalendar(events)
  const upcoming = expandCalendar(cal, today, addDays(today, 7)).filter((e) => !e.allDay)
  for (let i = 0; i < upcoming.length; i++) {
    for (let j = i + 1; j < upcoming.length; j++) {
      const a = upcoming[i]
      const b = upcoming[j]
      if (a.seriesId === b.seriesId || !overlaps(a, b)) continue
      const [x, y] = [a, b].sort((p, q) => `${p.seriesId}${p.occurrence}`.localeCompare(`${q.seriesId}${q.occurrence}`))
      push('event.clash', `event.clash:${x.seriesId}@${x.occurrence}|${y.seriesId}@${y.occurrence}`, { a: a.title, b: b.title, day: dayWord(a.start.slice(0, 10)) }, { cta: { label: 'Open Calendar', route: '/calendar' } })
    }
  }

  // tasks well past due
  const tasks = deriveTasks(events, now)
  for (const t of tasks.open) {
    if (!t.due) continue
    const late = daysBetween(t.due, today)
    if (late > 3) push('task.overdue', `task.overdue:${t.id}`, { title: t.title, days: late }, { cta: { label: 'Open Tasks', route: '/tasks' } })
  }

  // habits: a streak at risk, a habit that has dipped
  const history = habitHistory(events)
  for (const h of tasks.habits) {
    if (h.cadence !== 'daily' || paused.has(h.area)) continue
    if (h.streak >= 5 && !h.checkedToday && hour >= 18) push('streak.risk', `streak.risk:${h.id}`, { name: h.name, days: h.streak }, { area: h.area, cta: { label: 'Open Tasks', route: '/tasks' } })
    const hist = history.get(h.id)
    if (hist && daysBetween(hist.definedOn, today) >= 28) {
      let recentN = 0
      let before = 0
      for (let i = 0; i < 7; i++) if (hist.checks.has(addDays(today, -i))) recentN += 1
      for (let i = 7; i < 28; i++) if (hist.checks.has(addDays(today, -i))) before += 1
      const rate = before / 21
      if (rate >= 0.7 && recentN / 7 < 0.3 * rate) push('habit.dip', `habit.dip:${h.id}`, { name: h.name, recent: recentN, usual: Math.round(rate * 7) }, { area: h.area, cta: { label: 'Open Tasks', route: '/tasks' } })
    }
    // a streak milestone reached today or yesterday
    const marks = [100, 60, 30, 14, 7]
    const mark = marks.find((m) => h.streak >= m)
    if (mark && h.streak - mark <= 1) push('win.streak', `win.streak:${h.id}:${mark}`, { name: h.name, days: mark }, { area: h.area })
  }

  // goals: stalled, and milestones finished
  const goals = deriveGoals(events)
  const progress = goalProgressAt(events)
  for (const g of goals.active) {
    if (paused.has(g.area)) continue
    const lastAt = progress.last.get(g.id)
    if (!lastAt) continue
    const idle = daysBetween(localDate(lastAt), today)
    const age = daysBetween(localDate(progress.created.get(g.id) ?? lastAt), today)
    if (age >= 10 && idle >= 10 && (g.total === 0 || g.doneCount < g.total)) push('goal.stalled', `goal.stalled:${g.id}`, { title: g.title, days: idle }, { area: g.area, coach: { goalId: g.id, title: g.title }, cta: { label: 'Open Goals', route: '/goals' } })
  }
  const goalById = new Map(goals.goals.map((g) => [g.id, g]))
  for (const w of progress.wins) {
    const g = goalById.get(w.goalId)
    if (!g || paused.has(g.area) || !recent(w.at)) continue
    const milestone = w.done ? null : g.milestones.find((m) => m.id === w.milestoneId)?.text
    push('win.goal', `win.goal:${w.goalId}:${w.done ? 'done' : w.milestoneId}`, { title: g.title, milestone: milestone ?? 'a milestone', done: w.done }, { area: g.area })
  }

  // money: a budget over for the second month in a row
  const prev = money.spendByMonth[monthPrev(money.month)]
  for (const b of money.budgets) {
    if (b.over && (prev?.byCategory[b.category] ?? 0) > b.monthlyCents) push('budget.over', `budget.over:${b.category}`, { category: b.category }, { cta: { label: 'Open Money', route: '/money' } })
  }

  // learning reviews piling up
  const learning = evState.trackers.find((t) => t.id === 'learning')
  if (learning && !paused.has(learning.area)) {
    const due = reviewQueue(trackerEntries(events, 'learning'), now).filter((q) => q.due)
    if (due.length >= 10) push('review.overflow', 'review.overflow', { count: due.length }, { area: learning.area, cta: { label: 'Open Learning', route: '/learning' } })
  }

  // areas: silent, or lopsided
  for (const area of AREAS) {
    if (paused.has(area)) continue
    const hasSkills = Object.keys(evState.skills[area] ?? {}).length > 0
    const last = evState.lastGrowthAt[area]
    if (hasSkills && last) {
      const idle = daysBetween(localDate(last), today)
      if (idle >= 14) push('area.silent', `area.silent:${area}`, { area: areaName(area), days: idle }, { area, cta: { label: 'Open the tree', route: '/' } })
    }
  }
  const byArea = {}
  let total = 0
  for (const entry of evState.entries) {
    if (daysBetween(localDate(entry.createdAt), today) > 30) break
    for (const u of entry.updates) {
      if (u.xpGain > 0) {
        byArea[u.domain] = (byArea[u.domain] ?? 0) + u.xpGain
        total += u.xpGain
      }
    }
  }
  const open = AREAS.filter((a) => !paused.has(a))
  const silentAreas = open.filter((a) => !byArea[a])
  const top = open.slice().sort((a, b) => (byArea[b] ?? 0) - (byArea[a] ?? 0))[0]
  if (total >= 30 && top && byArea[top] / total >= 0.7 && silentAreas.length >= 2) {
    push('focus.skew', 'focus.skew', { area: areaName(top), percent: Math.round((byArea[top] / total) * 100), silent: silentAreas.length }, { area: top, cta: { label: 'Open the tree', route: '/' } })
  }

  // wins: a level that is a multiple of five, and the first growth in an area
  for (const l of levelUps(evState)) {
    if (paused.has(l.area) || !recent(l.at)) continue
    push('win.level', `win.level:${l.area}:${l.skillId}:${l.level}`, { skill: l.private ? areaName(l.area) : l.name, level: l.level }, { area: l.area, private: l.private })
  }
  const firstByArea = {}
  for (const entry of [...evState.entries].reverse()) {
    for (const u of entry.updates) if (u.xpGain > 0 && !firstByArea[u.domain]) firstByArea[u.domain] = entry.createdAt
  }
  for (const [area, at] of Object.entries(firstByArea)) {
    if (!paused.has(area) && recent(at)) push('win.first', `win.first:${area}`, { area: areaName(area) }, { area })
  }

  return out.sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key))
}

// The words for one observation. The wording rotates with how often this kind was shown before.
export function wording(obs, shownBefore = 0) {
  const list = WORDINGS[obs.obsId]
  const text = list[shownBefore % list.length](obs.params)
  return text
}

// What leaves the app in a notification: nothing private, just where to look.
export function notificationLine(obs, shownBefore = 0) {
  return obs.private ? (GENERIC[obs.obsId] ?? 'Something in a private area is worth a look.') : wording(obs, shownBefore)
}

export const inQuietHours = (now) => now.getHours() >= QUIET.from || now.getHours() < QUIET.to

/**
 * Which of the candidates may be shown now, and which of those are new (to be recorded).
 * A note already shown today stays on screen for the day; a new one has to clear the limits.
 */
export function chooseNotes(candidates, events, now = new Date(), { speakUp = 'necessary' } = {}) {
  const limits = SPEAK_UP[speakUp] ?? SPEAK_UP.necessary
  if (!limits.perDay) return { show: [], fresh: [] }
  const today = localDate(now)
  const fb = feedbackState(events, now)
  const shownKinds = new Map() // obsId -> how many times shown on earlier days, which sets the wording
  const lastShown = new Map() // key -> latest date shown before today
  const shownToday = new Set()
  for (const n of fb.shown) {
    if (n.date === today) {
      shownToday.add(n.key)
      continue
    }
    shownKinds.set(n.obsId, (shownKinds.get(n.obsId) ?? 0) + 1)
    if (!lastShown.has(n.key) || n.date > lastShown.get(n.key)) lastShown.set(n.key, n.date)
  }
  const quiet = inQuietHours(now)

  const eligible = candidates.filter((c) => c.priority <= limits.maxPriority && !fb.mutedIds.has(c.obsId))
  const show = []
  const fresh = []
  const withWords = (c) => ({ ...c, text: wording(c, shownKinds.get(c.obsId) ?? 0) })
  // Those already on screen today come first and keep their place.
  for (const c of eligible) if (shownToday.has(c.key)) show.push(withWords(c))
  let room = limits.perDay - shownToday.size
  for (const c of eligible) {
    if (room <= 0) break
    if (shownToday.has(c.key)) continue
    if (quiet && c.priority > 1) continue
    const cool = CATALOG[c.obsId].cooldown === 'once' ? ONCE : CATALOG[c.obsId].cooldown
    const last = lastShown.get(c.key)
    if (last && daysBetween(last, today) < cool) continue
    show.push(withWords(c))
    fresh.push(c)
    room -= 1
  }
  return { show, fresh }
}

// The one line that goes into the evening briefing (spec: "1 line, generic if private").
// Uses the same limits as the app but not the daily count (a bill that is still overdue is still worth a line).
export function briefingNote(events, now = new Date(), { speakUp = 'necessary' } = {}) {
  const limits = SPEAK_UP[speakUp] ?? SPEAK_UP.necessary
  if (!limits.perDay) return null
  const fb = feedbackState(events, now)
  const candidates = observe(events, now).filter((c) => c.priority <= limits.maxPriority && !fb.mutedIds.has(c.obsId))
  const pick = inQuietHours(now) ? candidates.find((c) => c.priority === 1) : candidates[0]
  if (!pick) return null
  const today = localDate(now)
  const shownBefore = fb.shown.filter((n) => n.obsId === pick.obsId && n.date !== today).length
  return { obsId: pick.obsId, private: pick.private, text: notificationLine(pick, shownBefore) }
}
