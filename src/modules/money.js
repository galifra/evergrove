import { createEvent, effectiveEvents, localDate } from '../core/events'
import { findOne } from '../core/match'
import { slugify } from '../lib/treeEngine'

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
    return `${y}-${bm}-${bd}`
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
        accounts.set(d.accountId, { id: d.accountId, name: d.name, kind: d.kind, balanceCents: d.balanceCents, date: d.date })
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
  const netWorthCents = accountList.reduce((s, a) => s + (a.kind === 'debt' ? -a.balanceCents : a.balanceCents), 0)

  return {
    purchases: purchases.sort((a, b) => b.date.localeCompare(a.date) || b.eventId.localeCompare(a.eventId)),
    thisMonth,
    month,
    spendByMonth,
    budgets: budgetRows,
    bills: billRows,
    goals: [...goals.values()],
    accounts: accountList,
    netWorthCents,
    subscriptionsMonthlyCents,
    recurring: detectRecurring(purchases, [...bills.values()]),
    closedMonths,
    today,
  }
}

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
  for (const [merchant, list] of groups) {
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
      description: 'Log something you bought. Amount is in dollars.',
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
        },
        required: ['name', 'kind', 'balance'],
      },
      run(args, { now }) {
        return {
          summary: `${args.name} balance: ${formatCents(toCents(args.balance))} (${args.kind}).`,
          events: [
            {
              type: 'money.account.balance',
              data: { accountId: slugify(args.name), name: args.name, kind: args.kind, balanceCents: toCents(args.balance), date: localDate(now) },
            },
          ],
        }
      },
    },
  ],
}
