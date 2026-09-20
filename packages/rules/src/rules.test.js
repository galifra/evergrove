import { describe, it, expect } from 'vitest'
import { AREAS, createEvent } from '@evergrove/core/events.js'
import { RULES, RULES_VERSION } from './rules'
import { deriveEvergrove } from './derive'
import { deriveInsights } from './insights'

// One test per growth rule and per observing rule (backlog T2.2), plus a guard
// that a new rule cannot be added without one, and that insights never become facts (T2.4).

let n = 0
const mk = (type, data, over = {}) =>
  createEvent({ id: `r${n++}`, type, app: over.app ?? 'test', area: over.area ?? null, occurredAt: over.at ?? '2026-05-15T12:00:00.000Z', data, ...over })

const xpOf = (events, area, id) => deriveEvergrove(events).skills[area]?.[id]?.xp

// Each rule: a small set of events and what the tree must look like afterward.
const CASES = {
  'skill.added': () => {
    const s = deriveEvergrove([mk('skill.added', { domain: 'craft', skillName: 'Woodworking' })])
    expect(s.skills.craft.woodworking.xp).toBe(0)
  },
  'skill.practiced': () => {
    expect(xpOf([mk('skill.practiced', { domain: 'health', skillName: 'Running', xp: 12 })], 'health', 'running')).toBe(12)
    expect(xpOf([mk('skill.practiced', { domain: 'health', skillName: 'Running', xp: 999 })], 'health', 'running')).toBe(40)
    expect(deriveEvergrove([mk('skill.practiced', { domain: 'nowhere', skillName: 'X', xp: 5 })]).skills).toEqual({})
  },
  'tracker.entry': () => {
    const ev = [mk('tracker.entry', { trackerId: 'body', values: { kind: 'Running', minutes: 30 } })]
    expect(xpOf(ev, 'health', 'running')).toBe(10)
    expect(deriveEvergrove([mk('tracker.entry', { trackerId: 'no-such-tracker', values: {} })]).skills).toEqual({})
  },
  'task.completed': () => {
    const ev = [mk('task.created', { taskId: 't1', title: 'x', effort: 3 }), mk('task.completed', { taskId: 't1', title: 'x' })]
    expect(xpOf(ev, 'discipline', 'getting-things-done')).toBe(6)
  },
  'habit.checked': () => {
    const ev = [mk('habit.defined', { habitId: 'stretch', name: 'Stretch', area: 'health' }), mk('habit.checked', { habitId: 'stretch', date: '2026-05-15' }), mk('habit.checked', { habitId: 'stretch', date: '2026-05-15' })]
    expect(xpOf(ev, 'health', 'stretch')).toBe(4)
  },
  'goal.milestone.done': () => {
    const ev = [mk('goal.created', { goalId: 'g1', title: 'Run a 10k', area: 'health' }), mk('goal.milestone.done', { goalId: 'g1', milestoneId: 'm1', text: '3k' })]
    expect(xpOf(ev, 'health', 'run-a-10k')).toBe(8)
  },
  'money.bill.paid': () => {
    expect(xpOf([mk('money.bill.paid', { name: 'Rent', dueOn: '2026-05-20', paidOn: '2026-05-19' })], 'discipline', 'paying-bills-on-time')).toBe(3)
    expect(xpOf([mk('money.bill.paid', { name: 'Rent', dueOn: '2026-05-20', paidOn: '2026-05-21' })], 'discipline', 'paying-bills-on-time')).toBeUndefined()
  },
  'money.goal.contributed': () => {
    expect(xpOf([mk('money.goal.contributed', { goalId: 'trip', amountCents: 20000 })], 'discipline', 'saving')).toBe(10)
    expect(xpOf([mk('money.goal.contributed', { goalId: 'trip', amountCents: 100 })], 'discipline', 'saving')).toBe(1)
  },
  'money.month.closed': () => {
    expect(xpOf([mk('money.month.closed', { month: '2026-04', withinBudget: true })], 'discipline', 'budgeting')).toBe(10)
    expect(xpOf([mk('money.month.closed', { month: '2026-04', withinBudget: false })], 'discipline', 'budgeting')).toBeUndefined()
  },
  'people.contact.logged': () => {
    expect(xpOf([mk('people.contact.logged', { personId: 'sam', text: 'Called Sam' })], 'social', 'staying-connected')).toBe(4)
  },
  'security.checked': () => {
    const on = (id, checked) => mk('security.checked', { itemId: id, checked, date: '2026-05-15' })
    expect(xpOf([on('email-2fa', true)], 'discipline', 'digital-security')).toBe(3)
    expect(xpOf([on('email-2fa', true), on('email-2fa', false), on('email-2fa', true)], 'discipline', 'digital-security')).toBe(3)
    expect(xpOf([on('email-2fa', false)], 'discipline', 'digital-security')).toBeUndefined()
  },
  // Rules that only learn context: they must not grow anything themselves.
  'tracker.defined': () => {
    const def = { trackerId: 'plants', name: 'Plants', area: 'creativity', fields: [{ label: 'Plant', type: 'text', required: true }] }
    const s = deriveEvergrove([mk('tracker.defined', def)])
    expect(s.trackers.some((t) => t.id === 'plants')).toBe(true)
    expect(s.skills).toEqual({})
  },
  'habit.defined': () => expect(deriveEvergrove([mk('habit.defined', { habitId: 'h', name: 'H', area: 'health' })]).skills).toEqual({}),
  'goal.created': () => expect(deriveEvergrove([mk('goal.created', { goalId: 'g', title: 'G', area: 'craft' })]).skills).toEqual({}),
  'task.created': () => expect(deriveEvergrove([mk('task.created', { taskId: 't', title: 'T' })]).skills).toEqual({}),
  'app.requested': () => {
    const s = deriveEvergrove([mk('app.requested', { requestId: 'meals', name: 'Meals', purpose: 'Plan dinners' })])
    expect(s.appRequests).toHaveLength(1)
    expect(s.skills).toEqual({})
  },
  'tree.named': () => expect(deriveEvergrove([mk('tree.named', { name: '  My Grove  ' })]).treeName).toBe('My Grove'),
  'area.paused': () => expect(deriveEvergrove([mk('area.paused', { area: 'health' })]).paused).toEqual(['health']),
  'area.resumed': () => expect(deriveEvergrove([mk('area.paused', { area: 'health' }), mk('area.resumed', { area: 'health' }, { at: '2026-05-15T13:00:00.000Z' })]).paused).toEqual([]),
}

describe('growth rules, one test each', () => {
  for (const [type, check] of Object.entries(CASES)) it(type, check)

  it('every rule in the engine has a test above (a new rule cannot slip in untested)', () => {
    expect(Object.keys(RULES).sort()).toEqual(Object.keys(CASES).sort())
  })

  it('rules are versioned', () => {
    expect(Number.isInteger(RULES_VERSION)).toBe(true)
    expect(deriveEvergrove([]).rulesVersion).toBe(RULES_VERSION)
  })

  it('event types the tree does not know are ignored, not errors', () => {
    expect(() => deriveEvergrove([mk('something.unheard.of', { x: 1 })])).not.toThrow()
    expect(deriveEvergrove([mk('calendar.event.created', { eventId: 'e', title: 'x', start: '2026-05-20' })]).skills).toEqual({})
  })
})

describe('insights never become facts (T2.4)', () => {
  it('no rule listens for an insight, so nothing derived can feed back into the tree', () => {
    expect(Object.keys(RULES).filter((t) => /insight|nudge|suggest/i.test(t))).toEqual([])
    expect(AREAS.length).toBeGreaterThan(0)
  })

  it('computing insights changes neither the events nor the tree, and can be repeated freely', () => {
    const events = Object.freeze([mk('skill.practiced', { domain: 'health', skillName: 'Running', xp: 10 }, { at: '2026-01-01T12:00:00.000Z' })])
    const before = JSON.stringify(deriveEvergrove(events))
    const state = deriveEvergrove(events)
    const a = deriveInsights(state, new Date('2026-05-15T12:00:00Z'))
    const b = deriveInsights(state, new Date('2026-05-15T12:00:00Z'))
    expect(a).toEqual(b)
    expect(a.some((i) => /quiet/.test(i.message))).toBe(true)
    expect(JSON.stringify(deriveEvergrove(events))).toBe(before)
    expect(events).toHaveLength(1)
  })
})
