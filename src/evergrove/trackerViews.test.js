import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { openStore } from '../core/store'
import { createLog } from '../core/log'
import { createAppRegistry } from '../modules/index'
import { createEvent } from '../core/events'
import { BUILTIN_TRACKERS, validateEntry } from './trackers'
import { deriveEvergrove } from './derive'
import { deriveToday } from './today'
import { reviewQueue, REVIEW_STEPS, sideIncomeCents, trackerBlocks, trackerEntries, tripSpending, weightTrend, yearInReview } from './trackerViews'

const NOW = new Date(2026, 4, 15, 12) // Fri 2026-05-15
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h)
let log
let reg
beforeEach(async () => {
  log = createLog(await openStore(`tv-${Math.random()}`), { channelName: `tvc-${Math.random()}` })
  reg = createAppRegistry(log)
})
// Entries are stamped with an explicit time: the app's clock only ever moves forward, so
// back-dated test data has to be written straight into the log.
let seq = 0
const track = async (tracker, values, when = NOW) => {
  const def = BUILTIN_TRACKERS.find((t) => t.id === tracker)
  const v = validateEntry(def, values)
  expect(v.error).toBeUndefined()
  await log.append(createEvent({ id: `t${seq++}`, type: 'tracker.entry', app: tracker, area: def.area, occurredAt: when.toISOString(), data: { trackerId: tracker, values: v.values } }))
}
const practice = (area, skill, xp, when) =>
  log.append(createEvent({ id: `p${seq++}`, type: 'skill.practiced', app: 'evergrove', area, occurredAt: when.toISOString(), data: { domain: area, skillId: skill.toLowerCase(), skillName: skill, xp } }))
const blocks = (id, now = NOW) => trackerBlocks(id, log.getEvents(), now)
const text = (id, now = NOW) => blocks(id, now).flatMap((b) => b.lines).join(' | ')

describe('body: sets, reps, weight and weekly volume', () => {
  it('accepts the new fields and totals volume for the calendar week', async () => {
    await track('body', { kind: 'Lifting', minutes: 45, sets: 3, reps: 10, weight: 100 }, at(2026, 5, 11)) // Mon
    await track('body', { kind: 'Lifting', minutes: 40, sets: 5, reps: 5, weight: 135 }, at(2026, 5, 14))
    await track('body', { kind: 'Running', minutes: 30 }, at(2026, 5, 15))
    await track('body', { kind: 'Lifting', minutes: 30, sets: 4, reps: 8, weight: 50 }, at(2026, 5, 6)) // last week
    const t = text('body')
    expect(t).toMatch(/3 sessions, 115 min/)
    expect(t).toMatch(/volume this week: 6,375 .*last week 1,600/)
  })

  it('the assistant can log the new fields, and out-of-range sets are rejected instead of stored', async () => {
    const ok = await reg.invoke('evergrove__log_tracker_entry', { tracker: 'body', values: { kind: 'Lifting', minutes: 30, sets: 3, reps: 8, weight: 95 } })
    expect(ok.status).toBe('done')
    const r = await reg.invoke('evergrove__log_tracker_entry', { tracker: 'body', values: { kind: 'Lifting', minutes: 30, sets: 500 } }, { now: NOW })
    expect(r.status).toBe('error')
  })
})

describe('health: macros, weight trend, sleep', () => {
  it('sums today\'s meals including macros, and still reads old calorie-in-value entries', async () => {
    await track('health', { kind: 'meal', what: 'Oatmeal', calories: 350, protein: 12, carbs: 60, fat: 6 })
    await track('health', { kind: 'meal', what: 'Chicken bowl', calories: 650, protein: 45, carbs: 70, fat: 18 })
    await track('health', { kind: 'meal', what: 'Old style', value: 200 })
    await track('health', { kind: 'meal', what: 'Yesterday', calories: 900 }, at(2026, 5, 14))
    expect(text('health')).toMatch(/Today: 3 meals · 1,200 kcal · protein 57 g · carbs 130 g · fat 24 g\./)
  })

  it('computes a weight trend from what was typed, with no advice', async () => {
    for (const [d, v] of [[1, 175], [8, 174], [9, 173.6], [12, 173], [14, 172.4], [15, 172.2]]) await track('health', { kind: 'weight', value: v }, at(2026, 5, d))
    const w = weightTrend(trackerEntries(log.getEvents(), 'health'), NOW)
    expect(w.latest.value).toBe(172.2)
    expect(w.monthChange).toBeCloseTo(-2.8, 5)
    expect(w.weekChange).toBeLessThan(0)
    const t = text('health')
    expect(t).toMatch(/Latest: 172\.2 \(May 15\)/)
    expect(t).toMatch(/Past 30 days: −2\.8/)
    expect(t).not.toMatch(/should|diagnos|healthy|unhealthy/i)
  })

  it('averages sleep over the last 7 nights and says so when there are no meals', async () => {
    await track('health', { kind: 'sleep', value: 7 }, at(2026, 5, 14))
    await track('health', { kind: 'sleep', value: 8 }, at(2026, 5, 15))
    expect(text('health')).toMatch(/No meals logged today\..*Sleep, last 7 days: 7\.5 h on average \(2 nights logged\)/)
  })
})

describe('mind: mood trend and a gentle check-in', () => {
  it('averages mood and compares to the week before', async () => {
    await track('mind', { kind: 'journal', mood: 4 }, at(2026, 5, 14))
    await track('mind', { kind: 'journal', mood: 5 }, at(2026, 5, 15))
    await track('mind', { kind: 'journal', mood: 3 }, at(2026, 5, 8))
    const mood = blocks('mind').find((b) => b.id === 'mood')
    expect(mood.lines[0]).toBe('Averaging 4.5 out of 5 over the last 7 days (3 the week before).')
    expect(mood.series).toEqual([3, 4, 5])
  })

  it('offers kindness, not a diagnosis, after several low check-ins', async () => {
    for (const d of [12, 13, 14]) await track('mind', { kind: 'journal', mood: 2 }, at(2026, 5, d))
    const nudge = blocks('mind').find((b) => b.id === 'checkin')
    expect(nudge.tone).toBe('gentle')
    expect(nudge.lines[0]).toMatch(/last few check-ins have been low/)
    expect(nudge.lines[0]).not.toMatch(/depress|disorder|diagnos/i)
  })

  it('a quiet stretch gets a no-pressure prompt; a fresh entry does not', async () => {
    await track('mind', { kind: 'journal', mood: 4 }, at(2026, 5, 9))
    expect(blocks('mind').find((b) => b.id === 'checkin').lines[0]).toMatch(/No pressure/)
    await track('mind', { kind: 'journal', mood: 4 }, at(2026, 5, 15))
    expect(blocks('mind').find((b) => b.id === 'checkin')).toBeUndefined()
  })
})

describe('learning: spaced review queue', () => {
  const study = (extra = {}) => ({ subject: 'Spanish', minutes: 20, remember: 'ser vs estar', ...extra })

  it('an item is due the day after it was studied, then at growing gaps', async () => {
    await track('learning', study(), at(2026, 5, 10))
    let q = reviewQueue(trackerEntries(log.getEvents(), 'learning'), NOW)
    expect(q).toHaveLength(1)
    expect(q[0]).toMatchObject({ dueOn: '2026-05-11', due: true, step: 1, overdueDays: 4 })

    await track('learning', study({ type: 'review' }), at(2026, 5, 15))
    q = reviewQueue(trackerEntries(log.getEvents(), 'learning'), NOW)
    expect(q[0]).toMatchObject({ dueOn: '2026-05-18', due: false, step: 2 })

    for (let i = 0; i < REVIEW_STEPS.length - 1; i++) await track('learning', study({ type: 'review' }), at(2026, 5, 16 + i))
    expect(reviewQueue(trackerEntries(log.getEvents(), 'learning'), at(2027, 1, 1))).toEqual([])
  })

  it('entries without a remember note never enter the queue; separate notes are separate items', async () => {
    await track('learning', { subject: 'Guitar', minutes: 30 }, at(2026, 5, 10))
    await track('learning', study(), at(2026, 5, 10))
    await track('learning', study({ remember: 'preterite endings' }), at(2026, 5, 10))
    expect(reviewQueue(trackerEntries(log.getEvents(), 'learning'), NOW).map((q) => q.remember)).toEqual(['preterite endings', 'ser vs estar'])
  })

  it('shows what is due on the page and in Today, and clears once reviewed', async () => {
    await track('learning', study(), at(2026, 5, 10))
    expect(blocks('learning')[0].title).toBe('Due for review (1)')
    expect(deriveToday(log.getEvents(), NOW).map((i) => i.text).join(' ')).toMatch(/1 thing to review: Spanish/)
    await track('learning', study({ type: 'review' }), NOW)
    expect(blocks('learning')[0].title).toBe('Review queue')
    expect(deriveToday(log.getEvents(), NOW).map((i) => i.text).join(' ')).not.toMatch(/to review/)
  })
})

describe('career and hustles: pipelines', () => {
  it('counts each application at its latest stage', async () => {
    await track('career', { kind: 'application', title: 'Engineer', company: 'Acme', stage: 'applied' }, at(2026, 5, 1))
    await track('career', { kind: 'application', title: 'Engineer', company: 'Acme', stage: 'interview' }, at(2026, 5, 9))
    await track('career', { kind: 'application', title: 'Designer', company: 'Globex', stage: 'rejected' }, at(2026, 5, 10))
    await track('career', { kind: 'win', title: 'Shipped the thing' }, at(2026, 5, 12))
    const t = text('career')
    expect(t).toMatch(/1 interview · 1 rejected\./)
    expect(t).toMatch(/1 win logged this year/)
  })

  it('side income is in dollars, exact in cents, and by month', async () => {
    await track('hustles', { idea: 'Dog walking', status: 'earning', income: 120.5 }, at(2026, 5, 3))
    await track('hustles', { idea: 'Dog walking', status: 'earning', income: 80.25 }, at(2026, 5, 10))
    await track('hustles', { idea: 'Logo gigs', status: 'idea' }, at(2026, 4, 20))
    await track('hustles', { idea: 'Dog walking', status: 'earning', income: 50 }, at(2026, 4, 20))
    expect(sideIncomeCents(log.getEvents(), '2026-05')).toBe(20075)
    expect(sideIncomeCents(log.getEvents())).toBe(25075)
    const t = text('hustles')
    expect(t).toMatch(/1 idea · 1 earning\./)
    expect(t).toMatch(/This month \$200\.75 · all time \$250\.75\./)
  })
})

describe('travel: trips and their spending', () => {
  it('ties Money purchases in a travel category to the trip they mention', async () => {
    await track('travel', { trip: 'Japan', kind: 'plan', budget: 3000 })
    await track('travel', { trip: 'Lisbon', kind: 'plan' })
    await reg.invoke('money__log_purchase', { amount: 800, category: 'travel', merchant: 'Japan Airlines' }, { now: NOW })
    await reg.invoke('money__log_purchase', { amount: 150.5, category: 'travel', note: 'Lisbon hostel' }, { now: NOW })
    await reg.invoke('money__log_purchase', { amount: 60, category: 'travel', note: 'airport parking' }, { now: NOW })
    await reg.invoke('money__log_purchase', { amount: 999, category: 'groceries', note: 'Japan snacks' }, { now: NOW })
    const s = tripSpending(log.getEvents(), NOW)
    expect(s.trips.find((t) => t.name === 'Japan')).toMatchObject({ spentCents: 80000, budgetCents: 300000 })
    expect(s.trips.find((t) => t.name === 'Lisbon').spentCents).toBe(15050)
    expect(s.otherCents).toBe(6000)
    expect(text('travel')).toMatch(/Japan: \$800\.00 spent of \$3,000\.00 budget\./)
  })

  it('flags a trip that is over budget', async () => {
    await track('travel', { trip: 'Japan', kind: 'plan', budget: 500 })
    await reg.invoke('money__log_purchase', { amount: 800, category: 'travel', merchant: 'Japan Airlines' }, { now: NOW })
    expect(text('travel')).toMatch(/\(over\)/)
  })
})

describe('compass: the year in review', () => {
  it('totals growth per area for one year and names the quiet areas', async () => {
    await practice('health', 'Running', 20, at(2026, 3, 1))
    await practice('health', 'Running', 10, at(2026, 3, 2))
    await practice('mind', 'Reading', 8, at(2026, 4, 2))
    await practice('mind', 'Reading', 40, at(2025, 12, 31))
    const r = yearInReview(deriveEvergrove(log.getEvents()), 2026)
    expect(r.totalXp).toBe(38)
    expect(r.activeDays).toBe(3)
    expect(r.areas[0]).toMatchObject({ area: 'health', xp: 30 })
    expect(r.topSkills[0]).toMatchObject({ name: 'Running', xp: 30 })
    expect(r.quiet.length).toBeGreaterThan(0)
    expect(r.quiet).not.toContain('Health')
  })
})

describe('trackers without a summary', () => {
  it('return no blocks instead of failing', () => {
    expect(trackerBlocks('selfcare', log.getEvents(), NOW)).toEqual([])
    expect(trackerBlocks('nonexistent', log.getEvents(), NOW)).toEqual([])
  })
})
