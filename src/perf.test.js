import { describe, it, expect } from 'vitest'
import { createEvent } from './core/events'
import { deriveEvergrove } from './evergrove/derive'
import { deriveToday } from './evergrove/today'
import { deriveTasks } from './modules/tasks'
import { deriveMoney } from './modules/money'
import { deriveCalendar } from './modules/calendar'

// Phase 9: does the app stay quick with years of use? Every screen re-derives
// from the whole log, so this is the number that matters.

const NOW = new Date(2026, 8, 18, 12)

function synthetic(days, perDay = 14) {
  const events = []
  let n = 0
  const id = () => `p${n++}`
  events.push(createEvent({ id: id(), type: 'habit.defined', app: 'tasks', area: 'health', data: { habitId: 'stretch', name: 'Stretch', area: 'health' } }))
  events.push(createEvent({ id: id(), type: 'money.budget.set', app: 'money', area: 'discipline', data: { category: 'dining', monthlyCents: 30000 } }))
  for (let d = 0; d < days; d++) {
    const day = new Date(2026, 8, 18 - d, 9)
    const iso = day.toISOString()
    const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
    events.push(createEvent({ id: id(), type: 'habit.checked', app: 'tasks', area: 'health', occurredAt: iso, data: { habitId: 'stretch', date } }))
    for (let k = 0; k < perDay - 1; k++) {
      const pick = k % 4
      if (pick === 0) events.push(createEvent({ id: id(), type: 'tracker.entry', app: 'body', area: 'health', occurredAt: iso, data: { trackerId: 'body', values: { kind: ['Running', 'Lifting', 'Yoga'][k % 3], minutes: 20 + k } } }))
      else if (pick === 1) events.push(createEvent({ id: id(), type: 'money.purchase.logged', app: 'money', area: 'discipline', occurredAt: iso, data: { purchaseId: id(), amountCents: 500 + k * 37, category: 'dining', merchant: `Place ${k}`, date } }))
      else if (pick === 2) events.push(createEvent({ id: id(), type: 'task.created', app: 'tasks', area: 'discipline', occurredAt: iso, data: { taskId: `t${n}`, title: `Task ${n}`, effort: 1 } }))
      else events.push(createEvent({ id: id(), type: 'skill.practiced', app: 'evergrove', area: 'mind', occurredAt: iso, data: { domain: 'mind', skillName: `Skill ${k % 9}`, xp: 5 } }))
    }
  }
  return events
}

const time = (fn) => {
  const t = performance.now()
  fn()
  return performance.now() - t
}

describe('performance with years of data', () => {
  for (const [label, days] of [['1 year', 365], ['3 years', 1095], ['10 years', 3650]]) {
    it(`${label}: every derive stays fast`, () => {
      const events = synthetic(days)
      const ms = {
        tree: time(() => deriveEvergrove(events)),
        tasks: time(() => deriveTasks(events, NOW)),
        money: time(() => deriveMoney(events, NOW)),
        calendar: time(() => deriveCalendar(events)),
        today: time(() => deriveToday(events, NOW)),
      }
      const worst = Math.max(...Object.values(ms))
      console.log(`${label} (${events.length} events):`, Object.fromEntries(Object.entries(ms).map(([k, v]) => [k, Math.round(v) + 'ms'])))
      // a screen should never need more than about a fifth of a second of derivation
      expect(worst).toBeLessThan(label === '10 years' ? 1500 : 500)
    })
  }
})
