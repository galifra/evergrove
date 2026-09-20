import { AREAS } from '@evergrove/core/events.js'
import { slugify } from '@evergrove/core/lib/treeEngine.js'
import { BUILTIN_TRACKERS, normalizeTrackerDef, trackerGrowth } from './trackers'

// Growth rules v1 (see docs/SPEC.md section 4). Each rule can `observe` an
// event to learn context (definitions), and `grow` to say what it is worth.
// Rules are pure: same effective events in, same tree out.
export const RULES_VERSION = 1

const clamp = (n, min, max) => Math.min(max, Math.max(min, n))

export function newContext() {
  return {
    trackers: new Map(BUILTIN_TRACKERS.map((t) => [t.id, t])),
    habits: new Map(),
    goals: new Map(),
    tasks: new Map(),
    habitDays: new Set(),
    paused: new Set(),
    treeName: null,
    appRequests: new Map(),
    securityDone: new Set(),
  }
}

function growth(domain, skillName, xp, text) {
  const name = String(skillName || 'Skill').trim().slice(0, 60) || 'Skill'
  return { domain, skillId: slugify(name), skillName: name, xp, text }
}

export const RULES = {
  'tracker.defined': {
    observe(e, ctx) {
      const def = normalizeTrackerDef({ ...e.data, id: e.data.trackerId })
      if (def) ctx.trackers.set(def.id, def)
    },
  },
  'habit.defined': {
    observe(e, ctx) {
      const { habitId, name, area } = e.data
      if (habitId && AREAS.includes(area)) ctx.habits.set(habitId, { name: String(name || habitId), area })
    },
  },
  'goal.created': {
    observe(e, ctx) {
      const { goalId, title, area } = e.data
      if (goalId && AREAS.includes(area)) ctx.goals.set(goalId, { title: String(title || 'Goal'), area })
    },
  },
  'task.created': {
    observe(e, ctx) {
      const { taskId, effort, goalId } = e.data
      if (taskId) ctx.tasks.set(taskId, { effort: clamp(Math.round(Number(effort) || 1), 1, 3), goalId })
    },
  },
  'app.requested': {
    observe(e, ctx) {
      const d = e.data
      if (d.requestId && d.name) ctx.appRequests.set(d.requestId, { id: d.requestId, name: d.name, purpose: d.purpose ?? '', tracks: d.tracks ?? '', screens: d.screens ?? '', area: d.area ?? null, eventId: e.id, requestedAt: e.occurredAt })
    },
  },
  // The tree's name lives in the log so every device shows the same one.
  'tree.named': {
    observe(e, ctx) {
      const name = String(e.data.name ?? '').trim().slice(0, 40)
      if (name) ctx.treeName = name
    },
  },
  'area.paused': { observe: (e, ctx) => ctx.paused.add(e.data.area) },
  'area.resumed': { observe: (e, ctx) => ctx.paused.delete(e.data.area) },

  'skill.added': {
    grow(e) {
      const { domain, skillName } = e.data
      return AREAS.includes(domain) && skillName ? [{ ...growth(domain, skillName, 0), text: `Planted ${skillName}` }] : []
    },
  },
  'skill.practiced': {
    grow(e) {
      const { domain, skillId, skillName, xp, text } = e.data
      if (!AREAS.includes(domain)) return []
      const name = skillName || skillId
      if (!name) return []
      const g = growth(domain, name, clamp(Math.round(Number(xp) || 0), 1, 40), text)
      if (skillId) g.skillId = slugify(skillId)
      return [g]
    },
  },
  'tracker.entry': {
    grow(e, ctx) {
      const def = ctx.trackers.get(e.data.trackerId)
      if (!def) return []
      const g = trackerGrowth(def, e.data.values)
      // `source` marks growth that came from a private tracker, so what it is called never reaches the AI unless shared.
      return [{ ...g, text: summarizeValues(def, e.data.values), source: def.sensitive ? def.id : null }]
    },
  },
  'task.completed': {
    grow(e, ctx) {
      const task = ctx.tasks.get(e.data.taskId)
      const goal = task?.goalId ? ctx.goals.get(task.goalId) : null
      const effort = task?.effort ?? clamp(Math.round(Number(e.data.effort) || 1), 1, 3)
      return [growth(goal?.area ?? 'discipline', goal?.title ?? 'Getting things done', 2 * effort, e.data.title)]
    },
  },
  'habit.checked': {
    grow(e, ctx) {
      const habit = ctx.habits.get(e.data.habitId)
      if (!habit) return []
      const key = `${e.data.habitId}|${e.data.date}`
      if (ctx.habitDays.has(key)) return []
      ctx.habitDays.add(key)
      return [growth(habit.area, habit.name, 4, `${habit.name}`)]
    },
  },
  'goal.milestone.done': {
    grow(e, ctx) {
      const goal = ctx.goals.get(e.data.goalId)
      return goal ? [growth(goal.area, goal.title, 8, e.data.text)] : []
    },
  },
  'money.bill.paid': {
    grow(e) {
      const { paidOn, dueOn, name } = e.data
      if (!paidOn || !dueOn || paidOn > dueOn) return []
      return [growth('discipline', 'Paying bills on time', 3, `Paid ${name ?? 'a bill'} on time`)]
    },
  },
  'money.goal.contributed': {
    grow(e) {
      const cents = Math.max(0, Math.round(Number(e.data.amountCents) || 0))
      const xp = clamp(Math.round(cents / 2000), 1, 15)
      return [growth('discipline', 'Saving', xp, 'Added to savings')]
    },
  },
  // Ticking a checklist item earns growth the first time only, so un-ticking
  // and re-ticking can never be used to farm it.
  'security.checked': {
    grow(e, ctx) {
      const { itemId, checked } = e.data
      if (!checked || !itemId || ctx.securityDone.has(itemId)) return []
      ctx.securityDone.add(itemId)
      return [growth('discipline', 'Digital security', 3, 'Improved digital security')]
    },
  },
  'money.month.closed': {
    grow(e) {
      return e.data.withinBudget ? [growth('discipline', 'Budgeting', 10, `Stayed within budget in ${e.data.month}`)] : []
    },
  },
  'people.contact.logged': {
    grow(e) {
      return [growth('social', 'Staying connected', 4, e.data.text || 'Stayed in touch')]
    },
  },
}

function summarizeValues(def, values = {}) {
  const parts = def.fields
    .map((f) => (values[f.key] !== undefined && values[f.key] !== '' ? `${values[f.key]}` : null))
    .filter(Boolean)
  return `${def.name}: ${parts.join(', ')}`.slice(0, 160)
}
