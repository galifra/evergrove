import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { openStore } from '@evergrove/core/store.js'
import { createLog } from '@evergrove/core/log.js'
import { createAppRegistry } from '../registry'
import { deriveMoney, formatCents, billDueOn } from '@evergrove/modules/money.js'
import { aprToBps, compareStrategies, monthlyInterest, planDebtPayoff } from '@evergrove/modules/moneyPlanner.js'
import { deriveToday } from '../today'
import { deriveEvergrove } from '../derive'

const NOW = new Date(2026, 4, 15, 12)
let log
let reg
beforeEach(async () => {
  log = createLog(await openStore(`mx-${Math.random()}`), { channelName: `mxc-${Math.random()}` })
  reg = createAppRegistry(log)
})
const call = (n, a, opts = {}) => reg.invoke(n, a, { now: NOW, ...opts })
const money = () => deriveMoney(log.getEvents(), NOW)

const debt = (id, balanceCents, apr, minPaymentCents) => ({ id, name: id.toUpperCase(), balanceCents, aprBps: aprToBps(apr), minPaymentCents })

describe('debt payoff maths (integer cents)', () => {
  it('rounds monthly interest to the cent', () => {
    expect(monthlyInterest(100000, 1200)).toBe(1000) // $1,000 at 12% -> $10.00
    expect(monthlyInterest(33333, 1999)).toBe(555) // 33333 * 0.1999 / 12 = 555.26
    expect(aprToBps(24.99)).toBe(2499)
  })

  it('a single debt pays off in the expected number of months, and every cent is accounted for', () => {
    const plan = planDebtPayoff([debt('a', 100000, 12, 10000)], { startMonth: '2026-05' })
    expect(plan.months).toBe(11)
    expect(plan.totalPaidCents).toBe(100000 + plan.totalInterestCents)
    expect(plan.totalInterestCents).toBeGreaterThan(5000)
    expect(plan.totalInterestCents).toBeLessThan(6000)
    expect(plan.payoffMonth).toBe('2027-04')
    expect(plan.neverPaidOff).toBe(false)
  })

  it('an interest-free debt is just balance divided by payment', () => {
    const plan = planDebtPayoff([debt('a', 30000, 0, 10000)])
    expect(plan.months).toBe(3)
    expect(plan.totalInterestCents).toBe(0)
  })

  it('extra payments shorten it and save interest', () => {
    const base = planDebtPayoff([debt('a', 500000, 20, 15000)])
    const more = planDebtPayoff([debt('a', 500000, 20, 15000)], { extraCents: 10000 })
    expect(more.months).toBeLessThan(base.months)
    expect(more.totalInterestCents).toBeLessThan(base.totalInterestCents)
    expect(more.totalPaidCents).toBe(500000 + more.totalInterestCents)
  })

  it('avalanche never costs more interest than snowball; snowball clears the small one first', () => {
    const debts = [debt('a', 50000, 5, 2500), debt('b', 300000, 25, 9000), debt('c', 20000, 18, 2500)]
    const { avalanche, snowball, interestDifferenceCents } = compareStrategies(debts, { extraCents: 20000 })
    expect(interestDifferenceCents).toBeGreaterThanOrEqual(0)
    expect(snowball.order[0]).toMatchObject({ id: 'c', month: 1 })
    expect(avalanche.order.find((o) => o.id === 'c').month).toBeGreaterThan(1)
    for (const p of [avalanche, snowball]) expect(p.totalPaidCents).toBe(370000 + p.totalInterestCents)
    expect(avalanche.order).toHaveLength(3)
  })

  it('says so when the minimum does not even cover the interest', () => {
    const plan = planDebtPayoff([debt('a', 1000000, 24, 10000)])
    expect(plan.neverPaidOff).toBe(true)
    expect(plan.months).toBe(600)
    expect(plan.payoffMonth).toBeNull()
  })

  it('leaves out debts without a rate or minimum and names them', () => {
    const plan = planDebtPayoff([debt('a', 10000, 10, 5000), { id: 'b', name: 'B', balanceCents: 9000, aprBps: null, minPaymentCents: null }])
    expect(plan.skipped).toEqual(['B'])
    expect(plan.order.map((o) => o.id)).toEqual(['a'])
    expect(planDebtPayoff([{ id: 'b', name: 'B', balanceCents: 9000, aprBps: null, minPaymentCents: null }]).empty).toBe(true)
  })
})

describe('debts through the command channel', () => {
  it('records a rate and minimum, keeps them on a later plain balance update', async () => {
    await call('money__set_balance', { name: 'Visa', kind: 'debt', balance: 2000, apr: 22.9, minPayment: 60 })
    await call('money__set_balance', { name: 'Visa', kind: 'debt', balance: 1900 })
    expect(money().accounts[0]).toMatchObject({ balanceCents: 190000, aprBps: 2290, minPaymentCents: 6000 })
  })

  it('refuses a rate on an asset account', async () => {
    const r = await call('money__set_balance', { name: 'Checking', kind: 'asset', balance: 100, apr: 5 })
    expect(r.status).toBe('error')
  })

  it('plan_debt_payoff explains the result in words and changes nothing', async () => {
    await call('money__set_balance', { name: 'Visa', kind: 'debt', balance: 2000, apr: 22.9, minPayment: 60 })
    await call('money__set_balance', { name: 'Loan', kind: 'debt', balance: 5000, apr: 6, minPayment: 150 })
    const before = log.getEvents().length
    const r = await call('money__plan_debt_payoff', { extra: 100 })
    expect(r.status).toBe('done')
    expect(r.summary).toMatch(/Avalanche \(highest rate first\): debt-free in \d+ months \(20\d\d-\d\d\)/)
    expect(r.summary).toMatch(/Order cleared: /)
    const added = log.getEvents().slice(before).map((e) => e.type)
    expect(added.every((t) => t === 'command.executed')).toBe(true)
  })

  it('asks for the missing numbers instead of guessing', async () => {
    await call('money__set_balance', { name: 'Visa', kind: 'debt', balance: 2000 })
    const r = await call('money__plan_debt_payoff', {})
    expect(r.summary).toMatch(/need an interest rate and a minimum payment for: Visa/)
  })
})

describe('holdings and net worth', () => {
  it('counts holdings in net worth, updates in place, and removal needs approval', async () => {
    await call('money__set_balance', { name: 'Checking', kind: 'asset', balance: 1000 })
    await call('money__set_balance', { name: 'Card', kind: 'debt', balance: 300 })
    await call('money__set_holding', { name: 'Index fund', kind: 'fund', value: 5000, units: 12.5 })
    expect(money().netWorthCents).toBe(570000)
    await call('money__set_holding', { name: 'Index fund', kind: 'fund', value: 5250.5 })
    expect(money().holdings).toHaveLength(1)
    expect(money().investmentsCents).toBe(525050)
    expect((await call('money__remove_holding', { holding: 'index' })).status).toBe('needs-approval')
    await call('money__remove_holding', { holding: 'index' }, { approved: true })
    expect(money().holdings).toEqual([])
    expect(money().netWorthCents).toBe(70000)
  })

  it('holdings do not grow the tree', async () => {
    await call('money__set_holding', { name: 'Index fund', kind: 'fund', value: 5000 })
    expect(deriveEvergrove(log.getEvents()).skills).toEqual({})
  })
})

describe('cancel candidates', () => {
  beforeEach(async () => {
    await call('money__add_bill', { name: 'Streamflix', amount: 15.99, cadence: 'monthly', dueDay: 3 })
    await call('money__add_bill', { name: 'Cloud storage', amount: 120, cadence: 'yearly', dueDate: '2026-09-09' })
    await call('money__add_bill', { name: 'Rent', amount: 1000, cadence: 'monthly', dueDay: 1 })
  })

  it('adds up what cancelling would save each month and year, with yearly bills spread over 12', async () => {
    const r = await call('money__flag_cancel_candidate', { bill: 'streamflix' })
    expect(r.summary).toMatch(/\$15\.99 a month \(\$191\.88 a year\)/)
    await call('money__flag_cancel_candidate', { bill: 'cloud' })
    expect(money().cancelCandidates.map((c) => c.name)).toEqual(['Streamflix', 'Cloud storage'])
    expect(money().cancelSavings).toEqual({ monthlyCents: 1599 + 1000, yearlyCents: (1599 + 1000) * 12 })
    expect(money().guidance.find((g) => g.id === 'cancel').text).toMatch(/free about \$25\.99 a month/)
  })

  it('does not cancel anything and can be cleared, and repeating is a no-op', async () => {
    await call('money__flag_cancel_candidate', { bill: 'streamflix' })
    const again = await call('money__flag_cancel_candidate', { bill: 'streamflix' })
    expect(again.summary).toMatch(/already marked/)
    expect(money().bills.find((b) => b.id === 'streamflix').archived).toBe(false)
    await call('money__flag_cancel_candidate', { bill: 'streamflix', flagged: false })
    expect(money().cancelCandidates).toEqual([])
  })
})

describe('insurance and tax deadlines', () => {
  it('shows up as a deadline with no fake $0.00, in Today when close', async () => {
    const r = await call('money__add_deadline', { name: 'Car insurance renewal', date: '2026-05-17', kind: 'insurance' })
    expect(r.summary).toMatch(/every year/)
    const d = money().deadlines[0]
    expect(d).toMatchObject({ name: 'Car insurance renewal', dueOn: '2026-05-17', daysUntil: 2, cadence: 'yearly' })
    const text = deriveToday(log.getEvents(), NOW).map((i) => i.text).join(' ')
    expect(text).toMatch(/Car insurance renewal is due in 2 days\./)
    expect(text).not.toMatch(/\$0\.00/)
  })

  it('once done it comes back next year; a missed one is overdue until ticked off', async () => {
    await call('money__add_deadline', { name: 'Property tax', date: '2026-04-15', kind: 'tax', amount: 2400 })
    expect(money().deadlines[0].overdue).toBe(true)
    await call('money__pay_bill', { bill: 'property tax' })
    expect(money().deadlines[0]).toMatchObject({ dueOn: '2027-04-15', overdue: false })
  })

  it('a one-time deadline disappears when done; a plain bill in category tax also counts', async () => {
    await call('money__add_deadline', { name: 'Renew passport', date: '2026-06-01', kind: 'other', yearly: false })
    expect(money().deadlines).toHaveLength(1)
    await call('money__add_bill', { name: 'Estimated tax', amount: 900, cadence: 'yearly', dueDate: '2026-09-15', category: 'Tax' })
    expect(money().deadlines.map((d) => d.name)).toEqual(['Renew passport', 'Estimated tax'])
    await call('money__pay_bill', { bill: 'passport' })
    expect(money().deadlines.map((d) => d.name)).toEqual(['Estimated tax'])
  })

  it('a Feb 29 yearly date lands on Feb 28 in a normal year', () => {
    expect(billDueOn({ cadence: 'yearly', dueDate: '2028-02-29' }, '2027-06-01')).toBe('2027-06-01'.slice(0, 5) + '02-28')
    expect(billDueOn({ cadence: 'yearly', dueDate: '2028-02-29' }, '2028-06-01')).toBe('2028-02-29')
  })
})

describe('general guidance', () => {
  it('stays informational and about the user\'s own numbers', async () => {
    await call('money__set_balance', { name: 'Visa', kind: 'debt', balance: 2000, apr: 24, minPayment: 60 })
    await call('money__log_purchase', { amount: 20, category: 'dining' })
    await call('money__add_bill', { name: 'Domain', amount: 120, cadence: 'yearly', dueDate: '2026-06-20' })
    const g = money().guidance
    expect(g.find((x) => x.id === 'apr:visa').text).toMatch(/24% a year, roughly \$40\.00 of interest each month/)
    expect(g.find((x) => x.id === 'emergency')).toBeTruthy()
    expect(g.find((x) => x.id === 'yearly-soon').text).toMatch(/Domain \(\$120\.00, 2026-06-20\)/)
    const all = g.map((x) => x.text).join(' ')
    expect(all).not.toMatch(/\byou should (buy|sell|invest)\b/i)
  })

  it('no emergency-fund nudge once one exists, and no rate warning for a cheap loan', async () => {
    await call('money__add_savings_goal', { name: 'Emergency fund', target: 5000 })
    await call('money__log_purchase', { amount: 20, category: 'dining' })
    await call('money__set_balance', { name: 'Car loan', kind: 'debt', balance: 9000, apr: 5, minPayment: 300 })
    const ids = money().guidance.map((g) => g.id)
    expect(ids).not.toContain('emergency')
    expect(ids).not.toContain('apr:car-loan')
  })

  it('formatCents still formats negatives', () => {
    expect(formatCents(-1234)).toBe('-$12.34')
  })
})

describe('warranties and receipts (records)', () => {
  it('a warranty expiry is tracked like any other deadline, with no fake amount', async () => {
    const r = await call('money__add_deadline', { name: 'Laptop warranty ends', date: '2026-05-18', kind: 'warranty', yearly: false })
    expect(r.status).toBe('done')
    expect(money().deadlines[0]).toMatchObject({ name: 'Laptop warranty ends', category: 'warranty', daysUntil: 3 })
    expect(deriveToday(log.getEvents(), NOW).map((i) => i.text).join(' ')).toMatch(/Laptop warranty ends is due in 3 days\./)
  })

  it('the Records tracker accepts a receipt with its amount', async () => {
    const r = await reg.invoke('evergrove__log_tracker_entry', { tracker: 'records', values: { what: 'Laptop receipt', category: 'receipt', amountCents: 129900 } }, { now: NOW })
    expect(r.status).toBe('done')
  })
})
