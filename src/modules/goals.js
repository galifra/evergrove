import { AREAS, effectiveEvents } from '../core/events'
import { findOne } from '../core/match'
import { slugify } from '../lib/treeEngine'

let counter = 0
const uid = () => `goal-${Date.now().toString(36)}-${(counter++).toString(36)}`

export function deriveGoals(events) {
  const goals = new Map()
  for (const e of effectiveEvents(events)) {
    const d = e.data
    if (e.type === 'goal.created') {
      goals.set(d.goalId, {
        id: d.goalId,
        title: d.title,
        area: d.area,
        targetDate: d.targetDate ?? null,
        milestones: (d.milestones ?? []).map((m) => ({ ...m, done: false })),
        status: 'active',
      })
    } else if (e.type === 'goal.milestone.added') {
      goals.get(d.goalId)?.milestones.push({ id: d.milestoneId, text: d.text, done: false })
    } else if (e.type === 'goal.milestone.done') {
      const m = goals.get(d.goalId)?.milestones.find((x) => x.id === d.milestoneId)
      if (m) m.done = true
    } else if (e.type === 'goal.completed') {
      if (goals.has(d.goalId)) goals.get(d.goalId).status = 'done'
    } else if (e.type === 'goal.dropped') {
      if (goals.has(d.goalId)) goals.get(d.goalId).status = 'dropped'
    }
  }
  const list = [...goals.values()].map((g) => {
    const total = g.milestones.length
    const done = g.milestones.filter((m) => m.done).length
    return { ...g, progress: total ? done / total : g.status === 'done' ? 1 : 0, doneCount: done, total }
  })
  return { goals: list, active: list.filter((g) => g.status === 'active') }
}

export const goalsModule = {
  id: 'goals',
  name: 'Goals',
  icon: 'target',
  area: 'inner',
  description: 'Goals broken into milestones, tied to the life area they grow.',
  derive: deriveGoals,
  context(state) {
    return state.active.length
      ? 'Active goals: ' + state.active.map((g) => `${g.title} (${g.doneCount}/${g.total} milestones)`).join('; ')
      : ''
  },
  actions: [
    {
      name: 'create_goal',
      tier: 'auto',
      description: 'Create a goal with optional milestones. Pick the life area it grows.',
      input: {
        type: 'object',
        properties: {
          title: { type: 'string', maxLength: 80 },
          area: { type: 'string', enum: AREAS },
          targetDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          milestones: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 100 } },
        },
        required: ['title', 'area'],
      },
      run(args) {
        const goalId = slugify(args.title) + '-' + uid().slice(-4)
        const milestones = (args.milestones ?? []).map((text, i) => ({ id: `m${i + 1}`, text }))
        return {
          summary: `Created goal "${args.title}" with ${milestones.length} milestone${milestones.length === 1 ? '' : 's'}.`,
          events: [
            { type: 'goal.created', area: args.area, data: { goalId, title: args.title, area: args.area, targetDate: args.targetDate, milestones } },
          ],
        }
      },
    },
    {
      name: 'add_milestone',
      tier: 'auto',
      description: 'Add a milestone to an existing goal.',
      input: {
        type: 'object',
        properties: { goal: { type: 'string', maxLength: 80 }, text: { type: 'string', maxLength: 100 } },
        required: ['goal', 'text'],
      },
      run(args, { moduleState }) {
        const r = findOne(moduleState().active, args.goal, { noun: 'goal' })
        if (r.error) return { error: r.error }
        const milestoneId = `m${r.item.milestones.length + 1}-${uid().slice(-3)}`
        return {
          summary: `Added milestone "${args.text}" to "${r.item.title}".`,
          events: [{ type: 'goal.milestone.added', area: r.item.area, data: { goalId: r.item.id, milestoneId, text: args.text } }],
        }
      },
    },
    {
      name: 'complete_milestone',
      tier: 'auto',
      description: 'Mark a milestone of a goal as done.',
      input: {
        type: 'object',
        properties: { goal: { type: 'string', maxLength: 80 }, milestone: { type: 'string', maxLength: 100 } },
        required: ['goal', 'milestone'],
      },
      run(args, { moduleState }) {
        const g = findOne(moduleState().active, args.goal, { noun: 'goal' })
        if (g.error) return { error: g.error }
        const m = findOne(
          g.item.milestones.filter((x) => !x.done),
          args.milestone,
          { label: (x) => x.text, noun: 'open milestone' }
        )
        if (m.error) return { error: m.error }
        return {
          summary: `Milestone done: "${m.item.text}" (${g.item.title}).`,
          events: [
            { type: 'goal.milestone.done', area: g.item.area, data: { goalId: g.item.id, milestoneId: m.item.id, text: m.item.text } },
          ],
        }
      },
    },
    {
      name: 'complete_goal',
      tier: 'auto',
      description: 'Mark a whole goal as achieved.',
      input: { type: 'object', properties: { goal: { type: 'string', maxLength: 80 } }, required: ['goal'] },
      run(args, { moduleState }) {
        const r = findOne(moduleState().active, args.goal, { noun: 'goal' })
        if (r.error) return { error: r.error }
        return { summary: `Goal achieved: "${r.item.title}".`, events: [{ type: 'goal.completed', area: r.item.area, data: { goalId: r.item.id } }] }
      },
    },
    {
      name: 'drop_goal',
      tier: 'ask',
      description: 'Drop a goal you no longer want to pursue.',
      input: { type: 'object', properties: { goal: { type: 'string', maxLength: 80 } }, required: ['goal'] },
      run(args, { moduleState }) {
        const r = findOne(moduleState().active, args.goal, { noun: 'goal' })
        if (r.error) return { error: r.error }
        return { summary: `Dropped goal "${r.item.title}".`, events: [{ type: 'goal.dropped', area: r.item.area, data: { goalId: r.item.id } }] }
      },
    },
  ],
}
