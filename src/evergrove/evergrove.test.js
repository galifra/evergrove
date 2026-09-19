import { describe, it, expect } from 'vitest'
import { createEvent } from '../core/events'
import { deriveEvergrove } from './derive'
import { deriveInsights, growthStreak } from './insights'
import { legacyToEvents } from './migrate'
import { normalizeTrackerDef, trackerGrowth, validateEntry, BUILTIN_TRACKERS } from './trackers'
import { levelFromXp } from '../lib/treeEngine'

let n = 0
const mk = (type, data, over = {}) =>
  createEvent({ id: `x${n++}`, type, app: over.app ?? 'evergrove', area: over.area ?? 'health', data, ...over })

const practice = (skillName, xp, over = {}) =>
  mk('skill.practiced', { domain: 'health', skillId: skillName.toLowerCase(), skillName, xp, text: `did ${skillName}` }, over)

const xpOf = (state, area, id) => state.skills[area]?.[id]?.xp

describe('skill growth', () => {
  it('logging a skill grows it and creates a feed entry', () => {
    const s = deriveEvergrove([practice('Running', 12)])
    expect(xpOf(s, 'health', 'running')).toBe(12)
    expect(s.entries[0].updates[0]).toMatchObject({ skillName: 'Running', xpGain: 12 })
  })

  it('same event applied twice counts once (idempotent by id)', () => {
    const e = practice('Running', 12)
    // the log dedupes ids; simulate a store that is fed the same event twice
    const dedup = [...new Map([e, e].map((x) => [x.id, x])).values()]
    expect(xpOf(deriveEvergrove(dedup), 'health', 'running')).toBe(12)
  })

  it('clamps xp to 1-40 and ignores unknown areas', () => {
    const s = deriveEvergrove([
      practice('Big', 500),
      mk('skill.practiced', { domain: 'nope', skillName: 'X', xp: 5 }),
    ])
    expect(xpOf(s, 'health', 'big')).toBe(40)
    expect(Object.keys(s.skills)).toEqual(['health'])
  })

  it('the tree never depends on arrival order', () => {
    const evs = [
      practice('Running', 10, { occurredAt: '2026-05-01T10:00:00.000Z' }),
      practice('Running', 7, { occurredAt: '2026-05-02T10:00:00.000Z' }),
      practice('Yoga', 5, { occurredAt: '2026-05-03T10:00:00.000Z' }),
      practice('Reading', 9, { occurredAt: '2026-05-04T10:00:00.000Z' }),
    ]
    const base = JSON.stringify(deriveEvergrove(evs).skills)
    for (let i = 0; i < 20; i++) {
      const shuffled = [...evs].sort(() => Math.random() - 0.5)
      expect(JSON.stringify(deriveEvergrove(shuffled).skills)).toBe(base)
    }
  })

  it('undo removes growth, undoing the undo restores it', () => {
    const a = practice('Running', 12)
    const undo = mk('event.reversed', {}, { supersedes: a.id })
    expect(deriveEvergrove([a, undo]).skills.health).toBeUndefined()
    const redo = mk('event.reversed', {}, { supersedes: undo.id })
    expect(xpOf(deriveEvergrove([a, undo, redo]), 'health', 'running')).toBe(12)
  })

  it('skill.added plants a skill at zero xp', () => {
    const s = deriveEvergrove([mk('skill.added', { domain: 'creativity', skillName: 'Guitar' }, { area: 'creativity' })])
    expect(xpOf(s, 'creativity', 'guitar')).toBe(0)
  })
})

describe('tree name', () => {
  it('the latest name in the log wins, so every synced device agrees', () => {
    const a = mk('tree.named', { name: 'Old Grove' }, { area: null, now: new Date('2026-05-01T00:00:00Z') })
    const b = mk('tree.named', { name: '  New Grove  ' }, { area: null, now: new Date('2026-05-02T00:00:00Z'), occurredAt: '2026-05-02T00:00:00.000Z' })
    expect(deriveEvergrove([a, b]).treeName).toBe('New Grove')
    expect(deriveEvergrove([b, a]).treeName).toBe('New Grove')
    expect(deriveEvergrove([]).treeName).toBeNull()
  })
})

describe('rules for other apps', () => {
  it('a habit checked twice the same day earns once', () => {
    const def = mk('habit.defined', { habitId: 'h1', name: 'Stretch', area: 'health' }, { app: 'tasks' })
    const c1 = mk('habit.checked', { habitId: 'h1', date: '2026-05-01' }, { app: 'tasks' })
    const c2 = mk('habit.checked', { habitId: 'h1', date: '2026-05-01' }, { app: 'tasks' })
    const c3 = mk('habit.checked', { habitId: 'h1', date: '2026-05-02' }, { app: 'tasks' })
    expect(xpOf(deriveEvergrove([def, c1, c2, c3]), 'health', 'stretch')).toBe(8)
  })

  it('task xp scales with effort; reopening (reversal) removes it', () => {
    const t = mk('task.created', { taskId: 't1', title: 'Tax form', effort: 3 }, { app: 'tasks' })
    const done = mk('task.completed', { taskId: 't1', title: 'Tax form' }, { app: 'tasks' })
    expect(xpOf(deriveEvergrove([t, done]), 'discipline', 'getting-things-done')).toBe(6)
    const reopen = mk('event.reversed', {}, { supersedes: done.id, app: 'tasks' })
    expect(deriveEvergrove([t, done, reopen]).skills.discipline).toBeUndefined()
  })

  it('a task linked to a goal grows that goal in its own area', () => {
    const g = mk('goal.created', { goalId: 'g1', title: 'Run a 10k', area: 'health' }, { app: 'goals' })
    const t = mk('task.created', { taskId: 't1', effort: 2, goalId: 'g1' }, { app: 'tasks' })
    const done = mk('task.completed', { taskId: 't1' }, { app: 'tasks' })
    expect(xpOf(deriveEvergrove([g, t, done]), 'health', 'run-a-10k')).toBe(4)
  })

  it('late bills earn nothing, on-time bills earn 3', () => {
    const late = mk('money.bill.paid', { paidOn: '2026-05-06', dueOn: '2026-05-05', name: 'Rent' }, { app: 'money' })
    const ok = mk('money.bill.paid', { paidOn: '2026-05-05', dueOn: '2026-05-05', name: 'Rent' }, { app: 'money' })
    expect(deriveEvergrove([late]).skills.discipline).toBeUndefined()
    expect(xpOf(deriveEvergrove([ok]), 'discipline', 'paying-bills-on-time')).toBe(3)
  })

  it('purchases and calendar events grow nothing', () => {
    const s = deriveEvergrove([
      mk('money.purchase.logged', { amountCents: 1200 }, { app: 'money' }),
      mk('calendar.event.created', { title: 'Dinner' }, { app: 'calendar' }),
    ])
    expect(s.skills).toEqual({})
    expect(s.entries).toEqual([])
  })

  it('month closed under budget earns 10, over budget earns nothing', () => {
    const under = mk('money.month.closed', { month: '2026-04', withinBudget: true }, { app: 'money' })
    const over = mk('money.month.closed', { month: '2026-05', withinBudget: false }, { app: 'money' })
    expect(xpOf(deriveEvergrove([under, over]), 'discipline', 'budgeting')).toBe(10)
  })

  it('savings xp is derived from integer cents', () => {
    const c = mk('money.goal.contributed', { amountCents: 20000 }, { app: 'money' })
    expect(xpOf(deriveEvergrove([c]), 'discipline', 'saving')).toBe(10)
  })

  it('pausing an area is recorded without shrinking anything', () => {
    const p = practice('Running', 10)
    const pause = mk('area.paused', { area: 'health' })
    const s = deriveEvergrove([p, pause])
    expect(s.paused).toEqual(['health'])
    expect(xpOf(s, 'health', 'running')).toBe(10)
    expect(deriveEvergrove([p, pause, mk('area.resumed', { area: 'health' })]).paused).toEqual([])
  })
})

describe('trackers', () => {
  it('every built-in tracker is valid and self-consistent', () => {
    for (const t of BUILTIN_TRACKERS) {
      const norm = normalizeTrackerDef(t)
      expect(norm, t.id).not.toBeNull()
      expect(norm.fields.length).toBeGreaterThan(0)
    }
  })

  it('an entry grows the tracker area with xp from minutes', () => {
    const e = mk('tracker.entry', { trackerId: 'body', values: { kind: 'Running', minutes: 45 } }, { app: 'body' })
    expect(xpOf(deriveEvergrove([e]), 'health', 'running')).toBe(15)
  })

  it('validates entries: required, numeric bounds, select options', () => {
    const body = BUILTIN_TRACKERS.find((t) => t.id === 'body')
    expect(validateEntry(body, { minutes: 20 }).error).toMatch(/required/i)
    expect(validateEntry(body, { kind: 'Run', minutes: 'abc' }).error).toMatch(/number/)
    expect(validateEntry(body, { kind: 'Run', minutes: 9999 }).error).toMatch(/at most/)
    expect(validateEntry(body, { kind: 'Run', minutes: 20, intensity: 'insane' }).error).toMatch(/one of/)
    expect(validateEntry(body, { kind: 'Run', minutes: '20', junk: 1 }).values).toEqual({ kind: 'Run', minutes: 20 })
  })

  it('a custom tracker defined by an event works end to end', () => {
    const def = mk('tracker.defined', {
      trackerId: 'plants',
      name: 'Plants',
      area: 'creativity',
      fields: [
        { key: 'plant', label: 'Plant', type: 'text', required: true },
        { key: 'ml', label: 'Water (ml)', type: 'number' },
      ],
      growth: { skill: { fixed: 'Gardening' }, xp: { field: 'ml', per: 100, min: 2, max: 10 } },
    })
    const entry = mk('tracker.entry', { trackerId: 'plants', values: { plant: 'Fern', ml: 500 } }, { app: 'plants' })
    const s = deriveEvergrove([def, entry])
    expect(xpOf(s, 'creativity', 'gardening')).toBe(5)
    expect(s.trackers.some((t) => t.id === 'plants')).toBe(true)
  })

  it('rejects a custom tracker with an invalid area', () => {
    expect(normalizeTrackerDef({ name: 'X', area: 'money', fields: [] })).toBeNull()
  })

  it('trackerGrowth falls back to the minimum xp on missing numbers', () => {
    const body = BUILTIN_TRACKERS.find((t) => t.id === 'body')
    expect(trackerGrowth(body, { kind: 'Yoga' }).xp).toBe(3)
  })
})

describe('insights', () => {
  it('flags a quiet area but not a paused one', () => {
    const old = practice('Running', 10, { occurredAt: '2026-01-01T10:00:00.000Z' })
    const now = new Date('2026-01-12T10:00:00.000Z')
    expect(deriveInsights(deriveEvergrove([old]), now).map((i) => i.id)).toContain('quiet:health')
    const paused = deriveEvergrove([old, mk('area.paused', { area: 'health' })])
    expect(deriveInsights(paused, now).map((i) => i.id)).not.toContain('quiet:health')
  })

  it('computes streaks from occurredAt, so a late-arriving day fills a gap', () => {
    const days = new Set(['2026-01-03', '2026-01-02', '2026-01-01'])
    expect(growthStreak(days, new Date(2026, 0, 3, 12))).toBe(3)
    expect(growthStreak(new Set(['2026-01-03', '2026-01-01']), new Date(2026, 0, 3, 12))).toBe(1)
  })
})

describe('migration from the old localStorage tree', () => {
  const legacy = {
    skills: {
      health: { running: { id: 'running', name: 'Running', xp: 200, createdAt: '2026-01-01T00:00:00.000Z' } },
      mind: { reading: { id: 'reading', name: 'Reading', xp: 8, createdAt: '2026-01-02T00:00:00.000Z' } },
    },
    entries: [
      { id: 'a1', text: 'ran', createdAt: '2026-01-02T08:00:00.000Z', updates: [{ domain: 'health', skillId: 'running', skillName: 'Running', xpGain: 12 }] },
      {
        id: 'a2',
        text: 'ran and read',
        createdAt: '2026-01-03T08:00:00.000Z',
        updates: [
          { domain: 'health', skillId: 'running', skillName: 'Running', xpGain: 8 },
          { domain: 'mind', skillId: 'reading', skillName: 'Reading', xpGain: 8 },
        ],
      },
    ],
  }

  it('reproduces every skill total exactly, including xp older than the kept entries', () => {
    const s = deriveEvergrove(legacyToEvents(legacy))
    expect(xpOf(s, 'health', 'running')).toBe(200)
    expect(xpOf(s, 'mind', 'reading')).toBe(8)
    expect(levelFromXp(s.skills.health.running.xp)).toEqual(levelFromXp(legacy.skills.health.running.xp))
  })

  it('is idempotent: migrating twice yields the same ids', () => {
    const a = legacyToEvents(legacy).map((e) => e.id)
    const b = legacyToEvents(legacy).map((e) => e.id)
    expect(a).toEqual(b)
    expect(new Set(a).size).toBe(a.length)
  })
})
