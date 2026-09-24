import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { createEvent } from '@evergrove/core/events.js'
import { openStore } from '@evergrove/core/store.js'
import { createLog } from '@evergrove/core/log.js'
import { createAppRegistry, listApps, runMaintenance } from '../registry'
import { deriveEvergrove } from '../derive'
import { deriveTasks, dailyStreak } from '@evergrove/modules/tasks.js'
import { deriveCalendar, addMinutes, overlaps } from '@evergrove/modules/calendar.js'
import { deriveMoney, toCents, formatCents, detectRecurring, monthClosingEvents } from '@evergrove/modules/money.js'
import { deriveGoals } from '@evergrove/modules/goals.js'
import { derivePeople, nextBirthday } from '@evergrove/modules/people.js'
import { deriveVault, unlockVault, sealItem, openItem } from '@evergrove/modules/vault.js'
import { validateArgs } from '@evergrove/core/schema.js'

let log
let reg
const NOW = new Date(2026, 4, 15, 12, 0, 0) // Fri May 15 2026, local

beforeEach(async () => {
  const store = await openStore(`m-${Math.random()}`)
  log = createLog(store, { channelName: `mc-${Math.random()}` })
  reg = createAppRegistry(log)
})

const call = (name, args, opts = {}) => reg.invoke(name, args, { now: NOW, ...opts })
const tree = () => deriveEvergrove(log.getEvents())
const xp = (area, id) => tree().skills[area]?.[id]?.xp

describe('command channel', () => {
  it('runs auto actions, appends events, writes an audit trail', async () => {
    const r = await call('evergrove__practice_skill', { area: 'health', skill: 'Running', xp: 12 })
    expect(r.status).toBe('done')
    expect(xp('health', 'running')).toBe(12)
    const types = log.getEvents().map((e) => e.type)
    expect(types).toContain('skill.practiced')
    expect(types).toContain('command.executed')
  })

  it('an ask-tier action never runs without approval', async () => {
    await call('tasks__add_task', { title: 'Call the bank' })
    const before = log.getEvents().length
    const r = await call('tasks__delete_task', { task: 'bank' })
    expect(r.status).toBe('needs-approval')
    expect(log.getEvents().length).toBe(before)
    const ok = await call('tasks__delete_task', { task: 'bank' }, { approved: true })
    expect(ok.status).toBe('done')
    expect(deriveTasks(log.getEvents(), NOW).open.length).toBe(0)
  })

  it('suggest-only actions never run', async () => {
    reg.register({
      id: 'x',
      name: 'X',
      actions: [{ name: 'danger', tier: 'suggest', description: 'do a thing', run: () => ({ events: [{ type: 'a.b', data: {} }] }) }],
    })
    const r = await call('x__danger', {}, { approved: true })
    expect(r.status).toBe('suggest-only')
    expect(log.getEvents().length).toBe(0)
  })

  it('rejects unknown actions and bad arguments without touching the log', async () => {
    expect((await call('nope__nothing', {})).status).toBe('error')
    expect((await call('evergrove__practice_skill', { area: 'wealth', skill: 'x', xp: 5 })).status).toBe('error')
    expect((await call('evergrove__practice_skill', { area: 'health', skill: 'x', xp: 9999 })).status).toBe('error')
    expect((await call('evergrove__practice_skill', { area: 'health', skill: 'x' })).status).toBe('error')
    expect(log.getEvents().length).toBe(0)
  })

  it('times out slow actions', async () => {
    const slow = createAppRegistry(log)
    slow.register({ id: 's', name: 'S', actions: [{ name: 'hang', tier: 'auto', description: 'x', run: () => new Promise(() => {}) }] })
    const fast = (await import('@evergrove/core/registry.js')).createRegistry({ log, timeoutMs: 30 })
    fast.register({ id: 's', name: 'S', actions: [{ name: 'hang', tier: 'auto', description: 'x', run: () => new Promise(() => {}) }] })
    const r = await fast.invoke('s__hang', {})
    expect(r.status).toBe('error')
    expect(r.error).toMatch(/timed out/)
  })

  it('undo restores the tree, and undoing the undo brings it back', async () => {
    const r = await call('evergrove__practice_skill', { area: 'health', skill: 'Running', xp: 12 })
    expect(xp('health', 'running')).toBe(12)
    await reg.undo(r.commandId)
    expect(xp('health', 'running')).toBeUndefined()
    const reversals = log.getEvents().filter((e) => e.type === 'event.reversed')
    // cancel the cancellation of the practice event
    const target = reversals.find((e) => r.eventIds.includes(e.supersedes))
    await log.append(createEvent({ type: 'event.reversed', app: 'jarvis', supersedes: target.id }))
    expect(xp('health', 'running')).toBe(12)
  })

  it('one correlation id links the events of one request', async () => {
    await call('evergrove__practice_skill', { area: 'health', skill: 'Running', xp: 5 }, { correlationId: 'req-1' })
    expect(log.getEvents().every((e) => e.correlationId === 'req-1')).toBe(true)
  })
})

describe('argument validation', () => {
  it('coerces numeric strings, rejects garbage, drops unknown keys', () => {
    const schema = { type: 'object', properties: { n: { type: 'integer', minimum: 1, maximum: 5 }, s: { type: 'string', maxLength: 3 } }, required: ['n'] }
    expect(validateArgs(schema, { n: '3', extra: 1 }).value).toEqual({ n: 3 })
    expect(validateArgs(schema, { n: 'abc' }).error).toMatch(/number/)
    expect(validateArgs(schema, { n: 9 }).error).toMatch(/at most/)
    expect(validateArgs(schema, { n: 2, s: 'toolong' }).error).toMatch(/too long/)
    expect(validateArgs(schema, {}).error).toMatch(/required/)
  })
})

describe('tasks and habits', () => {
  it('adds, fuzzy-completes and grows the tree; ambiguity is refused, not guessed', async () => {
    await call('tasks__add_task', { title: 'File taxes', effort: 3 })
    await call('tasks__add_task', { title: 'Call dentist' })
    await call('tasks__add_task', { title: 'Call mom' })
    expect((await call('tasks__complete_task', { task: 'call' })).status).toBe('error')
    const done = await call('tasks__complete_task', { task: 'taxes' })
    expect(done.status).toBe('done')
    expect(xp('discipline', 'getting-things-done')).toBe(6)
    expect((await call('tasks__complete_task', { task: 'taxes' })).status).toBe('error')
  })

  it('a habit checked twice on the same day is idempotent and earns once', async () => {
    await call('tasks__add_habit', { name: 'Stretch', area: 'health' })
    await call('tasks__check_habit', { habit: 'stretch' })
    const again = await call('tasks__check_habit', { habit: 'stretch' })
    expect(again.summary).toMatch(/already/)
    expect(xp('health', 'stretch')).toBe(4)
  })

  it('computes daily streaks, keeping yesterday alive', () => {
    expect(dailyStreak(new Set(['2026-05-15', '2026-05-14', '2026-05-13']), '2026-05-15')).toBe(3)
    expect(dailyStreak(new Set(['2026-05-14', '2026-05-13']), '2026-05-15')).toBe(2)
    expect(dailyStreak(new Set(['2026-05-12']), '2026-05-15')).toBe(0)
  })

  it('weekly habits count against their target', async () => {
    await call('tasks__add_habit', { name: 'Lift', area: 'health', cadence: 'weekly', target: 2 })
    await call('tasks__check_habit', { habit: 'lift', date: '2026-05-11' })
    await call('tasks__check_habit', { habit: 'lift', date: '2026-05-13' })
    const h = deriveTasks(log.getEvents(), NOW).habits[0]
    expect(h.thisWeek).toBe(2)
    expect(h.streak).toBe(1)
  })

  it('un-completing a task removes its xp', async () => {
    await call('tasks__add_task', { title: 'Laundry' })
    const done = await call('tasks__complete_task', { task: 'laundry' })
    expect(xp('discipline', 'getting-things-done')).toBe(2)
    await reg.undo(done.commandId)
    expect(xp('discipline', 'getting-things-done')).toBeUndefined()
    expect(deriveTasks(log.getEvents(), NOW).open.length).toBe(1)
  })
})

describe('calendar', () => {
  it('detects conflicts, reschedules only with approval, and cancels', async () => {
    await call('calendar__add_event', { title: 'Dinner with Sam', start: '2026-05-20T19:00' })
    const clash = await call('calendar__add_event', { title: 'Gym', start: '2026-05-20T19:30' })
    expect(clash.summary).toMatch(/overlaps with Dinner with Sam/)
    expect((await call('calendar__reschedule_event', { event: 'dinner', start: '2026-05-22T19:00' })).status).toBe('needs-approval')
    await call('calendar__reschedule_event', { event: 'dinner', start: '2026-05-22T19:00' }, { approved: true })
    expect(deriveCalendar(log.getEvents()).events.find((e) => e.title.startsWith('Dinner')).start).toBe('2026-05-22T19:00')
    await call('calendar__cancel_event', { event: 'dinner' }, { approved: true })
    expect(deriveCalendar(log.getEvents()).events.map((e) => e.title)).toEqual(['Gym'])
  })

  it('has no growth effect', async () => {
    await call('calendar__add_event', { title: 'Dentist', start: '2026-05-21T09:00' })
    expect(tree().skills).toEqual({})
  })

  it('time helpers', () => {
    expect(addMinutes('2026-05-20T23:30', 60)).toBe('2026-05-21T00:30')
    expect(overlaps({ start: '2026-05-20T10:00', end: '2026-05-20T11:00' }, { start: '2026-05-20T11:00', end: '2026-05-20T12:00' })).toBe(false)
  })

  it('all-day items never conflict with anything', () => {
    const dayMarker = { start: '2026-05-20', allDay: true }
    expect(overlaps(dayMarker, { start: '2026-05-20T10:00', end: '2026-05-20T11:00' })).toBe(false)
    expect(overlaps(dayMarker, { start: '2026-05-20', allDay: true })).toBe(false)
  })
})

describe('money (tracking only, integer cents)', () => {
  it('converts dollars to cents without float drift', () => {
    expect(toCents(19.99)).toBe(1999)
    expect(toCents(0.1 + 0.2)).toBe(30)
    expect(toCents(1234.5)).toBe(123450)
    expect(formatCents(123450)).toBe('$1,234.50')
    expect(formatCents(-5)).toBe('-$0.05')
  })

  it('purchases update budgets but grow nothing', async () => {
    await call('money__set_budget', { category: 'dining', amount: 100 })
    await call('money__log_purchase', { amount: 42.5, category: 'Dining', merchant: 'Taco Place' })
    const m = deriveMoney(log.getEvents(), NOW)
    expect(m.thisMonth.totalCents).toBe(4250)
    expect(m.budgets[0]).toMatchObject({ category: 'dining', remainingCents: 5750, over: false })
    expect(tree().skills).toEqual({})
  })

  it('tracks a monthly bill, marks it paid on time for xp, then rolls to next month', async () => {
    await call('money__add_bill', { name: 'Rent', amount: 1200, cadence: 'monthly', dueDay: 20 })
    let m = deriveMoney(log.getEvents(), NOW)
    expect(m.bills[0]).toMatchObject({ dueOn: '2026-05-20', paid: false, overdue: false, daysUntil: 5 })
    await call('money__pay_bill', { bill: 'rent' })
    expect(xp('discipline', 'paying-bills-on-time')).toBe(3)
    m = deriveMoney(log.getEvents(), NOW)
    expect(m.bills[0]).toMatchObject({ dueOn: '2026-06-20', paid: false })
    expect(m.subscriptionsMonthlyCents).toBe(120000)
  })

  it('a late payment is recorded as late and earns nothing', async () => {
    await call('money__add_bill', { name: 'Phone', amount: 60, cadence: 'monthly', dueDay: 1 })
    const r = await call('money__pay_bill', { bill: 'phone' })
    expect(r.summary).toMatch(/late/)
    expect(xp('discipline', 'paying-bills-on-time')).toBeUndefined()
  })

  it('needs the missing due date instead of guessing', async () => {
    expect((await call('money__add_bill', { name: 'Gym', amount: 30, cadence: 'monthly' })).status).toBe('error')
    expect((await call('money__add_bill', { name: 'Car insurance', amount: 600, cadence: 'yearly' })).status).toBe('error')
  })

  it('yearly bills convert to a monthly equivalent in whole cents', async () => {
    await call('money__add_bill', { name: 'Domain', amount: 100, cadence: 'yearly', dueDate: '2026-11-03' })
    expect(deriveMoney(log.getEvents(), NOW).subscriptionsMonthlyCents).toBe(833)
  })

  it('savings goals and net worth are exact', async () => {
    await call('money__add_savings_goal', { name: 'Trip', target: 1000 })
    await call('money__contribute_savings', { goal: 'trip', amount: 250.25 })
    await call('money__set_balance', { name: 'Checking', kind: 'asset', balance: 2000 })
    await call('money__set_balance', { name: 'Card', kind: 'debt', balance: 500.5 })
    const m = deriveMoney(log.getEvents(), NOW)
    expect(m.goals[0].savedCents).toBe(25025)
    expect(m.netWorthCents).toBe(149950)
    expect(xp('discipline', 'saving')).toBe(13)
  })

  it('finds subscriptions you forgot about', () => {
    const p = (month, cents) => ({ merchant: 'StreamCo', amountCents: cents, date: `2026-${month}-05` })
    expect(detectRecurring([p('01', 1599), p('02', 1599), p('03', 1599)])).toEqual([{ merchant: 'StreamCo', months: 3, avgCents: 1599 }])
    expect(detectRecurring([p('01', 1599), p('02', 1599)])).toEqual([])
    expect(detectRecurring([p('01', 1599), p('02', 5000), p('03', 1599)])).toEqual([])
    expect(detectRecurring([p('01', 1599), p('02', 1599), p('03', 1599)], [{ name: 'streamco' }])).toEqual([])
  })

  it('closing a month is idempotent and rewards staying within budget', async () => {
    await log.append([
      createEvent({ type: 'money.budget.set', app: 'money', area: 'discipline', occurredAt: '2026-03-02T10:00:00.000Z', data: { category: 'dining', monthlyCents: 10000 } }),
      createEvent({ type: 'money.purchase.logged', app: 'money', area: 'discipline', occurredAt: '2026-03-05T10:00:00.000Z', data: { purchaseId: 'a', amountCents: 4000, category: 'dining', date: '2026-03-05' } }),
      createEvent({ type: 'money.purchase.logged', app: 'money', area: 'discipline', occurredAt: '2026-04-05T10:00:00.000Z', data: { purchaseId: 'b', amountCents: 15000, category: 'dining', date: '2026-04-05' } }),
    ])
    expect(await runMaintenance(log, NOW)).toBe(2)
    expect(await runMaintenance(log, NOW)).toBe(0)
    expect(monthClosingEvents(log.getEvents(), NOW).length).toBe(0) // the current month is never closed early
    const closed = log.getEvents().filter((e) => e.type === 'money.month.closed')
    expect(closed.map((e) => [e.data.month, e.data.withinBudget]).sort()).toEqual([['2026-03', true], ['2026-04', false]])
    expect(xp('discipline', 'budgeting')).toBe(10)
  })
})

describe('goals and people', () => {
  it('a milestone grows the goal in its own area', async () => {
    await call('goals__create_goal', { title: 'Run a 10k', area: 'health', milestones: ['Run 3k', 'Run 5k'] })
    await call('goals__complete_milestone', { goal: 'run a 10k', milestone: 'run 3k' })
    expect(xp('health', 'run-a-10k')).toBe(8)
    const g = deriveGoals(log.getEvents()).goals[0]
    expect(g.progress).toBe(0.5)
    expect((await call('goals__complete_milestone', { goal: 'run a 10k', milestone: 'run 3k' })).status).toBe('error')
    expect((await call('goals__drop_goal', { goal: 'run a 10k' })).status).toBe('needs-approval')
  })

  it('remembers people, merges likes, and finds upcoming birthdays', async () => {
    await call('people__save_person', { name: 'Sam', birthday: '05-20', likes: ['coffee'] })
    await call('people__save_person', { name: 'Sam', likes: ['hiking'], giftIdeas: ['trail map'] })
    const st = derivePeople(log.getEvents(), NOW)
    expect(st.people[0].likes).toEqual(['coffee', 'hiking'])
    expect(st.upcomingBirthdays[0].nextBirthday).toEqual({ date: '2026-05-20', inDays: 5 })
    expect(st.overdueContact.length).toBe(1)
    await call('people__log_contact', { person: 'sam', kind: 'call' })
    expect(derivePeople(log.getEvents(), NOW).overdueContact.length).toBe(0)
    expect(xp('social', 'staying-connected')).toBe(4)
    expect(nextBirthday('01-10', '2026-05-15').inDays).toBe(240)
  })
})

describe('vault', () => {
  it('encrypts items, opens them only with the right passphrase', async () => {
    const key = await unlockVault('correct horse', 1000)
    const sealed = await sealItem(key, { title: 'Passport', kind: 'identity', body: 'A1234567' })
    expect(JSON.stringify(sealed)).not.toContain('A1234567')
    expect(await openItem(key, sealed)).toBe('A1234567')
    const wrong = await unlockVault('wrong', 1000)
    await expect(openItem(wrong, sealed)).rejects.toThrow()
  })

  it('lists saved items and drops deleted ones', async () => {
    const key = await unlockVault('pw', 1000)
    const a = await sealItem(key, { title: 'Will', kind: 'legal', body: 'x' })
    const evs = [
      createEvent({ type: 'vault.item.saved', app: 'vault', data: a }),
      createEvent({ type: 'vault.item.deleted', app: 'vault', data: { itemId: a.itemId } }),
    ]
    expect(deriveVault([evs[0]]).items.length).toBe(1)
    expect(deriveVault(evs).items.length).toBe(0)
  })

  it('exposes nothing to Jarvis', () => {
    expect(reg.tools().some((t) => t.moduleId === 'vault')).toBe(false)
  })
})

describe('trackers and creating apps by talking', () => {
  it('logs to a built-in tracker with validation', async () => {
    const bad = await call('evergrove__log_tracker_entry', { tracker: 'body', values: { kind: 'Run' } })
    expect(bad.status).toBe('error')
    const ok = await call('evergrove__log_tracker_entry', { tracker: 'body', values: { kind: 'Running', minutes: 30 } })
    expect(ok.status).toBe('done')
    expect(xp('health', 'running')).toBe(10)
  })

  it('a tracker created by description appears as an app and grows the tree', async () => {
    const args = {
      name: 'Plants',
      area: 'creativity',
      fields: [{ label: 'Plant', type: 'text', required: true }, { label: 'Water ml', type: 'number' }],
      skillName: 'Gardening',
      xpPerEntry: 5,
    }
    expect((await call('evergrove__create_tracker', args)).status).toBe('needs-approval')
    expect((await call('evergrove__create_tracker', args, { approved: true })).status).toBe('done')
    expect(listApps(log.getEvents()).some((a) => a.id === 'plants' && a.kind === 'tracker')).toBe(true)
    expect((await call('evergrove__create_tracker', args, { approved: true })).status).toBe('error')
    const r = await call('evergrove__log_tracker_entry', { tracker: 'plants', values: { plant: 'Fern', water_ml: 200 } })
    expect(r.status).toBe('done')
    expect(xp('creativity', 'gardening')).toBe(5)
  })

  it('lists every planned life area as an app', () => {
    const ids = listApps([]).map((a) => a.id)
    for (const id of ['tasks', 'calendar', 'money', 'goals', 'people', 'vault', 'body', 'health', 'mind', 'selfcare', 'learning', 'creativity', 'career', 'hustles', 'travel', 'home', 'records', 'compass']) {
      expect(ids).toContain(id)
    }
  })
})

