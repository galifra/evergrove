import { createEvent, effectiveEvents, localDate } from '@evergrove/core/events.js'
import { findOne } from '@evergrove/core/match.js'
import { slugify } from '@evergrove/core/lib/treeEngine.js'
import { aprToBps, compareStrategies, describePlan, moneyGuidance, planDebtPayoff } from './moneyPlanner'

// Tracking only: nothing here moves or holds real money. Every amount is an
// integer number of cents; floating point never touches a total.

let counter = 0
const uid = (p) => `${p}-${Date.now().toString(36)}-${(counter++).toString(36)}`

export function toCents(dollars) {
  return Math.round(Number(dollars) * 100)
}

export function formatCents(cents) {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}$${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`
}

const monthOf = (dateStr) => dateStr.slice(0, 7)
const p2 = (n) => String(n).padStart(2, '0')
const daysInMonth = (y, m) => new Date(y, m, 0).getDate()

export function billDueOn(bill, month) {
  const [y, m] = month.split('-').map(Number)
  if (bill.cadence === 'monthly') return `${month}-${p2(Math.min(bill.dueDay ?? 1, daysInMonth(y, m)))}`
  if (bill.cadence === 'yearly') {
    const [, bm, bd] = bill.dueDate.split('-')
    return `${y}-${bm}-${p2(Math.min(Number(bd), daysInMonth(y, Number(bm))))}`
  }
  return bill.dueDate
}

function periodOf(bill, dateStr) {
  if (bill.cadence === 'monthly') return monthOf(dateStr)
  if (bill.cadence === 'yearly') return dateStr.slice(0, 4)
  return 'once'
}

function nextMonth(month) {
  const [y, m] = month.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${p2(m + 1)}`
}

export function monthlyEquivalent(bill) {
  if (bill.cadence === 'monthly') return bill.amountCents
  if (bill.cadence === 'yearly') return Math.round(bill.amountCents / 12)
  return 0
}

export function deriveMoney(events, now = new Date()) {
  const today = localDate(now)
  const month = monthOf(today)
  const purchases = []
  const bills = new Map()
  const budgets = new Map()
  const goals = new Map()
  const accounts = new Map()
  const holdings = new Map()
  const flagged = new Set()
  const paid = new Map() // billId -> Map(period -> event)
  const closedMonths = new Set()

  for (const e of effectiveEvents(events)) {
    const d = e.data
    switch (e.type) {
      case 'money.purchase.logged':
        purchases.push({ id: d.purchaseId ?? e.id, eventId: e.id, ...d, category: d.category || 'other', date: d.date })
        break
      case 'money.bill.defined':
        bills.set(d.billId, { id: d.billId, ...d, archived: false })
        break
      case 'money.bill.archived':
        if (bills.has(d.billId)) bills.get(d.billId).archived = true
        break
      case 'money.bill.paid': {
        if (!paid.has(d.billId)) paid.set(d.billId, new Map())
        paid.get(d.billId).set(d.period, { eventId: e.id, paidOn: d.paidOn, amountCents: d.amountCents })
        break
      }
      case 'money.budget.set':
        budgets.set(d.category, { category: d.category, monthlyCents: d.monthlyCents, setOn: e.occurredAt })
        break
      case 'money.goal.set':
        goals.set(d.goalId, { id: d.goalId, name: d.name, targetCents: d.targetCents, savedCents: goals.get(d.goalId)?.savedCents ?? 0 })
        break
      case 'money.goal.contributed':
        if (goals.has(d.goalId)) goals.get(d.goalId).savedCents += d.amountCents
        break
      case 'money.account.balance':
        accounts.set(d.accountId, {
          id: d.accountId,
          name: d.name,
          kind: d.kind,
          balanceCents: d.balanceCents,
          date: d.date,
          // A later balance update keeps the rate and minimum unless it gives new ones.
          aprBps: d.aprBps ?? accounts.get(d.accountId)?.aprBps ?? null,
          minPaymentCents: d.minPaymentCents ?? accounts.get(d.accountId)?.minPaymentCents ?? null,
        })
        break
      case 'money.holding.set':
        holdings.set(d.holdingId, { id: d.holdingId, name: d.name, kind: d.kind, units: d.units ?? null, valueCents: d.valueCents, date: d.date })
        break
      case 'money.holding.removed':
        holdings.delete(d.holdingId)
        break
      case 'money.bill.flagged':
        if (d.flagged) flagged.add(d.billId)
        else flagged.delete(d.billId)
        break
      case 'money.month.closed':
        closedMonths.add(d.month)
        break
      default:
    }
  }

  const spendByMonth = {}
  for (const p of purchases) {
    const m = monthOf(p.date)
    const bucket = (spendByMonth[m] ??= { totalCents: 0, byCategory: {} })
    bucket.totalCents += p.amountCents
    bucket.byCategory[p.category] = (bucket.byCategory[p.category] ?? 0) + p.amountCents
  }
  const thisMonth = spendByMonth[month] ?? { totalCents: 0, byCategory: {} }

  const budgetRows = [...budgets.values()].map((b) => {
    const spent = thisMonth.byCategory[b.category] ?? 0
    return { ...b, spentCents: spent, remainingCents: b.monthlyCents - spent, over: spent > b.monthlyCents }
  })

  const billRows = [...bills.values()]
    .filter((b) => !b.archived)
    .map((b) => {
      const periods = paid.get(b.id) ?? new Map()
      let dueOn
      let period
      if (b.cadence === 'once') {
        period = 'once'
        dueOn = b.dueDate
      } else {
        const thisPeriod = periodOf(b, today)
        const dueThis = billDueOn(b, b.cadence === 'monthly' ? month : today)
        if (periods.has(thisPeriod)) {
          const nextM = b.cadence === 'monthly' ? nextMonth(month) : `${Number(today.slice(0, 4)) + 1}-01`
          dueOn = billDueOn(b, b.cadence === 'monthly' ? nextM : `${Number(today.slice(0, 4)) + 1}-01`)
          period = b.cadence === 'monthly' ? nextM : String(Number(today.slice(0, 4)) + 1)
        } else {
          dueOn = dueThis
          period = thisPeriod
        }
      }
      const isPaid = periods.has(period)
      return {
        ...b,
        flagged: flagged.has(b.id),
        isDeadline: !!b.deadline || ['tax', 'insurance'].includes(String(b.category ?? '').toLowerCase()),
        period,
        dueOn,
        paid: isPaid,
        overdue: !isPaid && dueOn < today,
        daysUntil: Math.round((new Date(dueOn) - new Date(today)) / 86400000),
      }
    })
    .filter((b) => !(b.cadence === 'once' && b.paid))
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn))

  const subscriptionsMonthlyCents = [...bills.values()].filter((b) => !b.archived).reduce((s, b) => s + monthlyEquivalent(b), 0)
  const accountList = [...accounts.values()]
  const holdingList = [...holdings.values()].sort((a, b) => b.valueCents - a.valueCents || a.name.localeCompare(b.name))
  const investmentsCents = holdingList.reduce((s, h) => s + h.valueCents, 0)
  const netWorthCents = accountList.reduce((s, a) => s + (a.kind === 'debt' ? -a.balanceCents : a.balanceCents), 0) + investmentsCents

  const cancelCandidates = [...bills.values()]
    .filter((b) => !b.archived && flagged.has(b.id))
    .map((b) => ({ id: b.id, name: b.name, monthlyCents: monthlyEquivalent(b), yearlyCents: monthlyEquivalent(b) * 12 }))
  const cancelSavings = {
    monthlyCents: cancelCandidates.reduce((s, c) => s + c.monthlyCents, 0),
    yearlyCents: cancelCandidates.reduce((s, c) => s + c.yearlyCents, 0),
  }

  const state = {
    purchases: purchases.sort((a, b) => b.date.localeCompare(a.date) || b.eventId.localeCompare(a.eventId)),
    thisMonth,
    month,
    spendByMonth,
    budgets: budgetRows,
    bills: billRows,
    goals: [...goals.values()],
    accounts: accountList,
    holdings: holdingList,
    investmentsCents,
    netWorthCents,
    subscriptionsMonthlyCents,
    cancelCandidates,
    cancelSavings,
    deadlines: billRows.filter((b) => b.isDeadline),
    recurring: detectRecurring(purchases, [...bills.values()]),
    closedMonths,
    today,
  }
  state.guidance = moneyGuidance(state, { formatCents })
  return state
}

export const debtsOf = (state) => state.accounts.filter((a) => a.kind === 'debt')

// Same merchant in 3+ different months at a steady price looks like a
// subscription you may have forgotten about.
export function detectRecurring(purchases, bills = []) {
  const known = new Set(bills.map((b) => b.name.trim().toLowerCase()))
  const groups = new Map()
  for (const p of purchases) {
    const key = (p.merchant ?? '').trim().toLowerCase()
    if (!key || known.has(key)) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(p)
  }
  const out = []
  for (const list of groups.values()) {
    const months = new Set(list.map((p) => monthOf(p.date)))
    if (months.size < 3) continue
    const amounts = list.map((p) => p.amountCents)
    const max = Math.max(...amounts)
    const min = Math.min(...amounts)
    if ((max - min) * 10 > max) continue
    out.push({
      merchant: list[0].merchant,
      months: months.size,
      avgCents: Math.round(amounts.reduce((s, a) => s + a, 0) / amounts.length),
    })
  }
  return out
}

// Idempotent startup job: closes finished months that had budgets, with a
// deterministic id so two devices (or a reload) can never double-close.
export function monthClosingEvents(events, now = new Date()) {
  const eff = effectiveEvents(events)
  const currentMonth = monthOf(localDate(now))
  const closed = new Set(eff.filter((e) => e.type === 'money.month.closed').map((e) => e.data.month))
  const dates = eff
    .filter((e) => e.type === 'money.purchase.logged' || e.type === 'money.budget.set')
    .map((e) => (e.type === 'money.purchase.logged' ? e.data.date : localDate(e.occurredAt)))
    .sort()
  if (!dates.length) return []

  const out = []
  for (let m = monthOf(dates[0]); m < currentMonth; m = nextMonth(m)) {
    if (closed.has(m)) continue
    const budgets = new Map()
    for (const e of eff) {
      if (e.type === 'money.budget.set' && monthOf(localDate(e.occurredAt)) <= m) {
        budgets.set(e.data.category, e.data.monthlyCents)
      }
    }
    if (!budgets.size) continue
    const spend = {}
    let total = 0
    for (const e of eff) {
      if (e.type === 'money.purchase.logged' && monthOf(e.data.date) === m) {
        spend[e.data.category || 'other'] = (spend[e.data.category || 'other'] ?? 0) + e.data.amountCents
        total += e.data.amountCents
      }
    }
    const within = [...budgets].every(([cat, cap]) => (spend[cat] ?? 0) <= cap)
    out.push(
      createEvent({
        id: `money:month:${m}`,
        type: 'money.month.closed',
        app: 'money',
        area: 'discipline',
        actor: 'system',
        occurredAt: `${nextMonth(m)}-01T00:00:00.000Z`,
        now,
        data: { month: m, withinBudget: within, spentCents: total },
      })
    )
  }
  return out
}

const AMOUNT = { type: 'number', minimum: 0.01, maximum: 10_000_000 }
const DATE = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }

export const moneyModule = {
  id: 'money',
  name: 'Money',
  icon: 'wallet',
  area: 'discipline',
  description: 'Purchases, bills, budgets, savings and net worth. Tracking only, no real money moves.',
  sensitive: true,
  derive: deriveMoney,
  maintenance: monthClosingEvents,
  context(state) {
    const lines = [`Spent this month: ${formatCents(state.thisMonth.totalCents)}`]
    const over = state.budgets.filter((b) => b.over).map((b) => b.category)
    if (over.length) lines.push(`Over budget: ${over.join(', ')}`)
    const due = state.bills.filter((b) => !b.paid && b.daysUntil <= 7).map((b) => `${b.name} ${b.dueOn}`)
    if (due.length) lines.push(`Bills due soon: ${due.join('; ')}`)
    return lines.join('\n')
  },
  actions: [
    {
      name: 'log_purchase',
      tier: 'auto',
      description: 'Log something the user bought or paid for (money going out). Amount is in dollars. Never use this for money coming in (income, refunds); amounts are always positive.',
      input: {
        type: 'object',
        properties: {
          amount: AMOUNT,
          category: { type: 'string', maxLength: 30, description: 'e.g. groceries, dining, transport' },
          merchant: { type: 'string', maxLength: 60 },
          note: { type: 'string', maxLength: 120 },
          date: DATE,
        },
        required: ['amount', 'category'],
      },
      run(args, { now }) {
        const cents = toCents(args.amount)
        const date = args.date ?? localDate(now)
        return {
          summary: `Logged ${formatCents(cents)} for ${args.category}${args.merchant ? ` at ${args.merchant}` : ''}.`,
          events: [
            {
              type: 'money.purchase.logged',
              data: {
                purchaseId: uid('buy'),
                amountCents: cents,
                category: args.category.toLowerCase(),
                merchant: args.merchant,
                note: args.note,
                date,
              },
            },
          ],
        }
      },
    },
    {
      name: 'add_bill',
      tier: 'auto',
      description: 'Track a recurring or one-time bill or subscription with its due date.',
      input: {
        type: 'object',
        properties: {
          name: { type: 'string', maxLength: 60 },
          amount: AMOUNT,
          cadence: { type: 'string', enum: ['monthly', 'yearly', 'once'] },
          dueDay: { type: 'integer', minimum: 1, maximum: 31, description: 'Day of month, for monthly bills' },
          dueDate: { ...DATE, description: 'Date for yearly or one-time bills' },
          category: { type: 'string', maxLength: 30 },
        },
        required: ['name', 'amount', 'cadence'],
      },
      run(args) {
        if (args.cadence === 'monthly' && !args.dueDay) return { error: 'Which day of the month is it due?' }
        if (args.cadence !== 'monthly' && !args.dueDate) return { error: 'What date is it due?' }
        return {
          summary: `Tracking bill "${args.name}" (${formatCents(toCents(args.amount))} ${args.cadence}).`,
          events: [
            {
              type: 'money.bill.defined',
              data: {
                billId: slugify(args.name),
                name: args.name,
                amountCents: toCents(args.amount),
                cadence: args.cadence,
                dueDay: args.dueDay,
                dueDate: args.dueDate,
                category: args.category,
              },
            },
          ],
        }
      },
    },
    {
      name: 'pay_bill',
      tier: 'auto',
      description: 'Record that a tracked bill has been paid (bookkeeping only).',
      input: {
        type: 'object',
        properties: { bill: { type: 'string', maxLength: 60 }, date: DATE },
        required: ['bill'],
      },
      run(args, { moduleState, now }) {
        const state = moduleState()
        const r = findOne(state.bills.filter((b) => !b.paid), args.bill, { label: (b) => b.name, noun: 'unpaid bill' })
        if (r.error) return { error: r.error }
        const b = r.item
        const paidOn = args.date ?? localDate(now)
        return {
          summary: `Marked "${b.name}" paid${paidOn > b.dueOn ? ' (late)' : ''}.`,
          events: [
            {
              type: 'money.bill.paid',
              data: { billId: b.id, name: b.name, period: b.period, amountCents: b.amountCents, paidOn, dueOn: b.dueOn },
            },
          ],
        }
      },
    },
    {
      name: 'set_budget',
      tier: 'auto',
      description: 'Set a monthly budget for a spending category, in dollars.',
      input: {
        type: 'object',
        properties: { category: { type: 'string', maxLength: 30 }, amount: AMOUNT },
        required: ['category', 'amount'],
      },
      run(args) {
        return {
          summary: `Budget for ${args.category}: ${formatCents(toCents(args.amount))}/month.`,
          events: [{ type: 'money.budget.set', data: { category: args.category.toLowerCase(), monthlyCents: toCents(args.amount) } }],
        }
      },
    },
    {
      name: 'add_savings_goal',
      tier: 'auto',
      description: 'Create a savings goal with a target amount in dollars.',
      input: {
        type: 'object',
        properties: { name: { type: 'string', maxLength: 60 }, target: AMOUNT },
        required: ['name', 'target'],
      },
      run(args) {
        return {
          summary: `Savings goal "${args.name}": ${formatCents(toCents(args.target))}.`,
          events: [{ type: 'money.goal.set', data: { goalId: slugify(args.name), name: args.name, targetCents: toCents(args.target) } }],
        }
      },
    },
    {
      name: 'contribute_savings',
      tier: 'auto',
      description: 'Record an amount added toward a savings goal (bookkeeping only).',
      input: {
        type: 'object',
        properties: { goal: { type: 'string', maxLength: 60 }, amount: AMOUNT },
        required: ['goal', 'amount'],
      },
      run(args, { moduleState, now }) {
        const r = findOne(moduleState().goals, args.goal, { label: (g) => g.name, noun: 'savings goal' })
        if (r.error) return { error: r.error }
        return {
          summary: `Added ${formatCents(toCents(args.amount))} to "${r.item.name}".`,
          events: [
            { type: 'money.goal.contributed', data: { goalId: r.item.id, amountCents: toCents(args.amount), date: localDate(now) } },
          ],
        }
      },
    },
    {
      name: 'set_balance',
      tier: 'auto',
      description: 'Record the current balance of an account or debt (tracking only).',
      input: {
        type: 'object',
        properties: {
          name: { type: 'string', maxLength: 60 },
          kind: { type: 'string', enum: ['asset', 'debt'] },
          balance: { type: 'number', minimum: 0, maximum: 1_000_000_000 },
          apr: { type: 'number', minimum: 0, maximum: 100, description: 'Yearly interest rate in percent, for a debt (24.99 means 24.99%)' },
          minPayment: { type: 'number', minimum: 0.01, maximum: 10_000_000, description: 'Minimum monthly payment in dollars, for a debt' },
        },
        required: ['name', 'kind', 'balance'],
      },
      run(args, { now }) {
        if ((args.apr !== undefined || args.minPayment !== undefined) && args.kind !== 'debt') {
          return { error: 'An interest rate and minimum payment only apply to a debt.' }
        }
        return {
          summary: `${args.name} balance: ${formatCents(toCents(args.balance))} (${args.kind}).`,
          events: [
            {
              type: 'money.account.balance',
              data: {
                accountId: slugify(args.name),
                name: args.name,
                kind: args.kind,
                balanceCents: toCents(args.balance),
                aprBps: args.apr === undefined ? undefined : aprToBps(args.apr),
                minPaymentCents: args.minPayment === undefined ? undefined : toCents(args.minPayment),
                date: localDate(now),
              },
            },
          ],
        }
      },
    },
    {
      name: 'plan_debt_payoff',
      tier: 'auto',
      description:
        'Work out how long it takes to pay off the recorded debts and how much interest that costs, with an optional extra monthly payment. Read-only: nothing is paid or changed. Needs each debt to have an interest rate and minimum payment.',
      input: {
        type: 'object',
        properties: {
          extra: { type: 'number', minimum: 0, maximum: 10_000_000, description: 'Extra dollars per month on top of the minimums' },
          strategy: { type: 'string', enum: ['avalanche', 'snowball'], description: 'avalanche = highest rate first, snowball = smallest balance first' },
        },
      },
      run(args, { moduleState, now }) {
        const debts = debtsOf(moduleState())
        const opts = { extraCents: args.extra ? toCents(args.extra) : 0, startMonth: monthOf(localDate(now)) }
        if (args.strategy) return { summary: describePlan(planDebtPayoff(debts, { ...opts, strategy: args.strategy }), formatCents), events: [] }
        const both = compareStrategies(debts, opts)
        const text = [describePlan(both.avalanche, formatCents)]
        if (!both.avalanche.empty && !both.avalanche.neverPaidOff && both.interestDifferenceCents !== 0) {
          text.push(`Snowball would take ${both.snowball.months} months and cost ${formatCents(Math.abs(both.interestDifferenceCents))} ${both.interestDifferenceCents > 0 ? 'more' : 'less'} interest.`)
        }
        return { summary: text.join(' '), events: [] }
      },
    },
    {
      name: 'set_holding',
      tier: 'auto',
      description:
        'Record or update the value of an investment holding you own (typed in by hand, e.g. "index fund", "bitcoin"). Tracking only: no prices are fetched and nothing is bought or sold.',
      input: {
        type: 'object',
        properties: {
          name: { type: 'string', maxLength: 60 },
          kind: { type: 'string', enum: ['stock', 'fund', 'crypto', 'retirement', 'other'] },
          value: { type: 'number', minimum: 0, maximum: 1_000_000_000, description: 'Current total value in dollars' },
          units: { type: 'number', minimum: 0, maximum: 1_000_000_000_000, description: 'Shares or coins held, if you want to record them' },
        },
        required: ['name', 'kind', 'value'],
      },
      run(args, { now }) {
        return {
          summary: `${args.name} (${args.kind}) valued at ${formatCents(toCents(args.value))}.`,
          events: [
            {
              type: 'money.holding.set',
              data: { holdingId: slugify(args.name), name: args.name, kind: args.kind, valueCents: toCents(args.value), units: args.units, date: localDate(now) },
            },
          ],
        }
      },
    },
    {
      name: 'remove_holding',
      tier: 'ask',
      description: 'Stop tracking an investment holding.',
      input: { type: 'object', properties: { holding: { type: 'string', maxLength: 60 } }, required: ['holding'] },
      run(args, { moduleState }) {
        const r = findOne(moduleState().holdings, args.holding, { label: (h) => h.name, noun: 'holding' })
        if (r.error) return { error: r.error }
        return { summary: `Stopped tracking ${r.item.name}.`, events: [{ type: 'money.holding.removed', data: { holdingId: r.item.id } }] }
      },
    },
    {
      name: 'flag_cancel_candidate',
      tier: 'auto',
      description: 'Mark a bill or subscription as something the user is thinking of cancelling (or clear the mark). Shows how much cancelling would save. It does not cancel anything.',
      input: {
        type: 'object',
        properties: { bill: { type: 'string', maxLength: 60 }, flagged: { type: 'boolean', description: 'true to mark (default), false to clear' } },
        required: ['bill'],
      },
      run(args, { moduleState }) {
        const r = findOne(moduleState().bills, args.bill, { label: (b) => b.name, noun: 'bill' })
        if (r.error) return { error: r.error }
        const flag = args.flagged ?? true
        if (flag === r.item.flagged) return { summary: `"${r.item.name}" is already ${flag ? 'marked' : 'unmarked'}.`, events: [] }
        const monthly = monthlyEquivalent(r.item)
        return {
          summary: flag
            ? `Marked "${r.item.name}" as a cancel candidate. Cancelling would save about ${formatCents(monthly)} a month (${formatCents(monthly * 12)} a year).`
            : `"${r.item.name}" is no longer a cancel candidate.`,
          events: [{ type: 'money.bill.flagged', data: { billId: r.item.id, flagged: flag } }],
        }
      },
    },
    {
      name: 'add_deadline',
      tier: 'auto',
      description:
        'Track an insurance renewal, tax deadline, warranty expiry or similar date that must not be missed. Repeats every year unless one-time. Shows on the calendar and in Today, and can be ticked off when done. Only for a date still to come; something the user already did (filed, renewed, claimed) belongs in the Records tracker instead.',
      input: {
        type: 'object',
        properties: {
          name: { type: 'string', maxLength: 60 },
          date: DATE,
          kind: { type: 'string', enum: ['tax', 'insurance', 'warranty', 'license', 'other'] },
          yearly: { type: 'boolean', description: 'true (default) if it comes round every year' },
          amount: { type: 'number', minimum: 0.01, maximum: 10_000_000, description: 'Amount due in dollars, if known' },
        },
        required: ['name', 'date', 'kind'],
      },
      run(args) {
        const yearly = args.yearly ?? true
        return {
          summary: `Tracking ${args.kind} deadline "${args.name}" on ${args.date}${yearly ? ', every year' : ''}.`,
          events: [
            {
              type: 'money.bill.defined',
              data: {
                billId: slugify(args.name),
                name: args.name,
                amountCents: args.amount ? toCents(args.amount) : 0,
                cadence: yearly ? 'yearly' : 'once',
                dueDate: args.date,
                category: args.kind,
                deadline: true,
              },
            },
          ],
        }
      },
    },
  ],
}
