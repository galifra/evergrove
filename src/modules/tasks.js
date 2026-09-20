import { AREAS, effectiveEvents, localDate } from '../core/events'
import { findOne } from '../core/match'
import { slugify } from '../lib/treeEngine'

let counter = 0
const uid = (prefix) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`

const DAY = 24 * 60 * 60 * 1000

function addDays(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + delta)
  return localDate(dt)
}

// Monday-based week start for a local date string.
function weekStart(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const day = (dt.getDay() + 6) % 7
  dt.setDate(dt.getDate() - day)
  return localDate(dt)
}

export function deriveTasks(events, now = new Date()) {
  const today = localDate(now)
  const tasks = new Map()
  const habits = new Map()
  const completions = []

  for (const e of effectiveEvents(events)) {
    const d = e.data
    switch (e.type) {
      case 'task.created':
        tasks.set(d.taskId, {
          id: d.taskId,
          title: d.title,
          due: d.due ?? null,
          effort: d.effort ?? 1,
          goalId: d.goalId ?? null,
          repeatEveryDays: d.repeatEveryDays ?? null,
          createdAt: e.occurredAt,
          doneOn: null,
          completionEventId: null,
          timesDone: 0,
          lastDone: null,
          deleted: false,
        })
        break
      case 'task.completed': {
        const t = tasks.get(d.taskId)
        if (t) {
          const date = d.date ?? localDate(e.occurredAt)
          completions.push({ id: t.id, title: t.title, date, eventId: e.id })
          t.timesDone += 1
          t.lastDone = date
          if (t.repeatEveryDays) {
            // A repeating task never closes: it comes back N days after it was done.
            t.due = addDays(date, t.repeatEveryDays)
          } else {
            t.doneOn = date
            t.completionEventId = e.id
          }
        }
        break
      }
      case 'task.deleted': {
        const t = tasks.get(d.taskId)
        if (t) t.deleted = true
        break
      }
      case 'habit.defined':
        habits.set(d.habitId, {
          id: d.habitId,
          name: d.name,
          area: d.area,
          cadence: d.cadence ?? 'daily',
          target: d.target ?? 1,
          checks: new Set(),
          archived: false,
        })
        break
      case 'habit.checked': {
        const h = habits.get(d.habitId)
        if (h) h.checks.add(d.date)
        break
      }
      case 'habit.archived': {
        const h = habits.get(d.habitId)
        if (h) h.archived = true
        break
      }
      default:
    }
  }

  const all = [...tasks.values()].filter((t) => !t.deleted)
  const open = all
    .filter((t) => !t.doneOn)
    .sort((a, b) => (a.due ?? '9999') .localeCompare(b.due ?? '9999') || a.createdAt.localeCompare(b.createdAt))
  const doneToday = completions
    .filter((c) => c.date === today)
    .map((c) => ({ id: c.id, title: c.title, completionEventId: c.eventId }))

  const habitList = [...habits.values()]
    .filter((h) => !h.archived)
    .map((h) => ({
      id: h.id,
      name: h.name,
      area: h.area,
      cadence: h.cadence,
      target: h.target,
      checkedToday: h.checks.has(today),
      streak: h.cadence === 'weekly' ? weeklyStreak(h, today) : dailyStreak(h.checks, today),
      thisWeek: countInWeek(h.checks, today),
    }))

  return { open, doneToday, all, habits: habitList, today }
}

export function dailyStreak(checks, today) {
  let cursor = checks.has(today) ? today : addDays(today, -1)
  let streak = 0
  while (checks.has(cursor)) {
    streak += 1
    cursor = addDays(cursor, -1)
  }
  return streak
}

function countInWeek(checks, dateStr) {
  const start = weekStart(dateStr)
  let n = 0
  for (let i = 0; i < 7; i++) if (checks.has(addDays(start, i))) n += 1
  return n
}

// Consecutive weeks (ending this week or last) that met the weekly target.
function weeklyStreak(h, today) {
  let start = weekStart(today)
  const met = (s) => {
    let n = 0
    for (let i = 0; i < 7; i++) if (h.checks.has(addDays(s, i))) n += 1
    return n >= h.target
  }
  if (!met(start)) start = addDays(start, -7)
  let streak = 0
  while (met(start)) {
    streak += 1
    start = addDays(start, -7)
  }
  return streak
}

export const tasksModule = {
  id: 'tasks',
  name: 'Tasks & habits',
  icon: 'check-square',
  area: 'discipline',
  description: 'One-off tasks and recurring habits that keep you consistent.',
  derive: deriveTasks,
  context(state) {
    const lines = []
    if (state.open.length) {
      lines.push(
        'Open tasks: ' +
          state.open
            .slice(0, 8)
            .map((t) => `${t.title}${t.due ? ` (due ${t.due})` : ''}`)
            .join('; ')
      )
    }
    if (state.habits.length) {
      lines.push(
        'Habits: ' + state.habits.map((h) => `${h.name} [${h.cadence}${h.checkedToday ? ', done today' : ''}, streak ${h.streak}]`).join('; ')
      )
    }
    return lines.join('\n')
  },
  actions: [
    {
      name: 'add_task',
      tier: 'auto',
      description: 'Add a one-off task to the to-do list.',
      input: {
        type: 'object',
        properties: {
          title: { type: 'string', maxLength: 120 },
          due: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Due date YYYY-MM-DD' },
          effort: { type: 'integer', minimum: 1, maximum: 3, description: '1 quick, 2 medium, 3 big' },
          repeatEveryDays: {
            type: 'integer',
            minimum: 1,
            maximum: 730,
            description: 'Makes it a repeating task that comes back this many days after each completion (7 = weekly, 30 = about monthly, 365 = yearly). Good for chores and maintenance.',
          },
          goal: { type: 'string', maxLength: 80, description: 'Title of an existing goal this task works toward' },
        },
        required: ['title'],
      },
      run(args, { state, now }) {
        const taskId = uid('task')
        let goal = null
        if (args.goal) {
          const r = findOne(state('goals').active, args.goal, { noun: 'goal' })
          if (r.error) return { error: r.error }
          goal = r.item
        }
        const due = args.due ?? (args.repeatEveryDays ? addDays(localDate(now), args.repeatEveryDays) : undefined)
        return {
          summary:
            `Added ${args.repeatEveryDays ? `repeating task (every ${args.repeatEveryDays} day${args.repeatEveryDays === 1 ? '' : 's'}) ` : 'task '}"${args.title}"` +
            `${due ? ` due ${due}` : ''}${goal ? `, toward "${goal.title}"` : ''}.`,
          events: [
            {
              type: 'task.created',
              area: goal?.area,
              data: { taskId, title: args.title, due, effort: args.effort ?? 1, goalId: goal?.id, repeatEveryDays: args.repeatEveryDays },
            },
          ],
        }
      },
    },
    {
      name: 'complete_task',
      tier: 'auto',
      description: 'Mark an open task as done (identify it by its title).',
      input: { type: 'object', properties: { task: { type: 'string', maxLength: 120 } }, required: ['task'] },
      run(args, { moduleState, now }) {
        const { open } = moduleState()
        const r = findOne(open, args.task, { noun: 'open task' })
        if (r.error) return { error: r.error }
        if (r.item.repeatEveryDays && r.item.lastDone === localDate(now)) {
          return { summary: `"${r.item.title}" is already done today. It comes back on ${r.item.due}.`, events: [] }
        }
        return {
          summary: r.item.repeatEveryDays
            ? `Completed "${r.item.title}". It comes back on ${addDays(localDate(now), r.item.repeatEveryDays)}.`
            : `Completed "${r.item.title}".`,
          events: [{ type: 'task.completed', data: { taskId: r.item.id, title: r.item.title, date: localDate(now) } }],
        }
      },
    },
    {
      name: 'delete_task',
      tier: 'ask',
      description: 'Delete a task from the list (identify it by its title).',
      input: { type: 'object', properties: { task: { type: 'string', maxLength: 120 } }, required: ['task'] },
      run(args, { moduleState }) {
        const r = findOne(moduleState().open, args.task, { noun: 'open task' })
        if (r.error) return { error: r.error }
        return { summary: `Deleted task "${r.item.title}".`, events: [{ type: 'task.deleted', data: { taskId: r.item.id } }] }
      },
    },
    {
      name: 'add_habit',
      tier: 'auto',
      description:
        'Create a habit: a personal routine the user is building and wants a streak for (daily, or weekly with a target count). Chores and upkeep on a schedule are repeating tasks instead (add_task with repeatEveryDays).',
      input: {
        type: 'object',
        properties: {
          name: { type: 'string', maxLength: 60 },
          area: { type: 'string', enum: AREAS },
          cadence: { type: 'string', enum: ['daily', 'weekly'] },
          target: { type: 'integer', minimum: 1, maximum: 7, description: 'Times per week when cadence is weekly' },
        },
        required: ['name', 'area'],
      },
      run(args) {
        const habitId = slugify(args.name)
        return {
          summary: `Started habit "${args.name}" (${args.cadence ?? 'daily'}).`,
          events: [
            { type: 'habit.defined', area: args.area, data: { habitId, name: args.name, area: args.area, cadence: args.cadence ?? 'daily', target: args.target ?? 1 } },
          ],
        }
      },
    },
    {
      name: 'check_habit',
      tier: 'auto',
      description: 'Check off a habit for today (or a given date).',
      input: {
        type: 'object',
        properties: {
          habit: { type: 'string', maxLength: 60 },
          date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        },
        required: ['habit'],
      },
      run(args, { moduleState, now }) {
        const r = findOne(moduleState().habits, args.habit, { label: (h) => h.name, noun: 'habit' })
        if (r.error) return { error: r.error }
        const date = args.date ?? localDate(now)
        if (date === localDate(now) && r.item.checkedToday) return { summary: `"${r.item.name}" is already checked today.`, events: [] }
        return {
          summary: `Checked "${r.item.name}" for ${date}.`,
          events: [{ type: 'habit.checked', area: r.item.area, data: { habitId: r.item.id, date } }],
        }
      },
    },
    {
      name: 'archive_habit',
      tier: 'ask',
      description: 'Stop tracking a habit.',
      input: { type: 'object', properties: { habit: { type: 'string', maxLength: 60 } }, required: ['habit'] },
      run(args, { moduleState }) {
        const r = findOne(moduleState().habits, args.habit, { label: (h) => h.name, noun: 'habit' })
        if (r.error) return { error: r.error }
        return { summary: `Archived habit "${r.item.name}".`, events: [{ type: 'habit.archived', data: { habitId: r.item.id } }] }
      },
    },
  ],
}

export const _internals = { addDays, weekStart, DAY }
