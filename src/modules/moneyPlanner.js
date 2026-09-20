// Pure money maths and plain-language guidance. Everything is integer cents;
// interest is rounded to the cent every month, the way a statement does it.
// Nothing here is personalised advice - it explains how the numbers work.

const MAX_MONTHS = 600

const p2 = (n) => String(n).padStart(2, '0')

// APR is stored as basis points of a percent (24.99% -> 2499) so it stays an integer.
export const aprToBps = (apr) => Math.round(Number(apr) * 100)
export const monthlyInterest = (balanceCents, aprBps) => Math.round((balanceCents * aprBps) / 120000)

function addMonths(monthKey, n) {
  const [y, m] = monthKey.split('-').map(Number)
  const total = y * 12 + (m - 1) + n
  return `${Math.floor(total / 12)}-${p2((total % 12) + 1)}`
}

// Simulates paying off debts month by month. `extraCents` is on top of the
// minimums and stays in play as debts clear (freed minimums roll into the next
// one), which is what makes the two strategies different.
//   avalanche: put the extra on the highest interest rate first (least interest)
//   snowball:  put the extra on the smallest balance first (quickest wins)
export function planDebtPayoff(debts, { extraCents = 0, strategy = 'avalanche', startMonth } = {}) {
  const usable = debts.filter((d) => d.balanceCents > 0 && d.minPaymentCents > 0 && Number.isInteger(d.aprBps))
  const skipped = debts.filter((d) => d.balanceCents > 0 && !usable.includes(d)).map((d) => d.name)
  if (!usable.length) return { strategy, months: 0, totalInterestCents: 0, totalPaidCents: 0, order: [], skipped, neverPaidOff: false, payoffMonth: null, empty: true }

  const debtsLeft = usable.map((d) => ({ ...d, left: d.balanceCents }))
  const budget = debtsLeft.reduce((s, d) => s + d.minPaymentCents, 0) + Math.max(0, Math.round(extraCents))
  const rank = (a, b) =>
    strategy === 'snowball'
      ? a.left - b.left || b.aprBps - a.aprBps || a.id.localeCompare(b.id)
      : b.aprBps - a.aprBps || a.left - b.left || a.id.localeCompare(b.id)

  let months = 0
  let totalInterest = 0
  let totalPaid = 0
  const order = []
  while (debtsLeft.some((d) => d.left > 0) && months < MAX_MONTHS) {
    months += 1
    for (const d of debtsLeft) {
      if (d.left <= 0) continue
      const interest = monthlyInterest(d.left, d.aprBps)
      d.left += interest
      totalInterest += interest
    }
    let pool = budget
    // Minimums first, for every debt still open.
    for (const d of debtsLeft) {
      if (d.left <= 0) continue
      const pay = Math.min(d.minPaymentCents, d.left, pool)
      d.left -= pay
      pool -= pay
      totalPaid += pay
    }
    // Then whatever is left goes to the target debt, and spills to the next.
    for (const d of debtsLeft.filter((x) => x.left > 0).sort(rank)) {
      if (pool <= 0) break
      const pay = Math.min(pool, d.left)
      d.left -= pay
      pool -= pay
      totalPaid += pay
    }
    for (const d of debtsLeft) {
      if (d.left <= 0 && !order.some((o) => o.id === d.id)) order.push({ id: d.id, name: d.name, month: months })
    }
  }
  const neverPaidOff = debtsLeft.some((d) => d.left > 0)
  return {
    strategy,
    months,
    totalInterestCents: totalInterest,
    totalPaidCents: totalPaid,
    order,
    skipped,
    neverPaidOff,
    payoffMonth: !neverPaidOff && startMonth ? addMonths(startMonth, months) : null,
    empty: false,
  }
}

export function compareStrategies(debts, opts = {}) {
  const avalanche = planDebtPayoff(debts, { ...opts, strategy: 'avalanche' })
  const snowball = planDebtPayoff(debts, { ...opts, strategy: 'snowball' })
  return { avalanche, snowball, interestDifferenceCents: snowball.totalInterestCents - avalanche.totalInterestCents }
}

const ago = (n) => `${n} month${n === 1 ? '' : 's'}`

export function describePlan(plan, formatCents) {
  if (plan.empty) {
    return plan.skipped.length
      ? `To plan the payoff I need an interest rate and a minimum payment for: ${plan.skipped.join(', ')}.`
      : 'There are no debts recorded with a balance.'
  }
  const name = plan.strategy === 'snowball' ? 'Snowball (smallest balance first)' : 'Avalanche (highest rate first)'
  if (plan.neverPaidOff) {
    return `${name}: at these payments the debt is not paid off within 50 years. The minimums barely cover the interest, so any extra payment makes a big difference.`
  }
  const lines = [
    `${name}: debt-free in ${ago(plan.months)}${plan.payoffMonth ? ` (${plan.payoffMonth})` : ''}, with ${formatCents(plan.totalInterestCents)} total interest.`,
    `Order cleared: ${plan.order.map((o) => `${o.name} (month ${o.month})`).join(', ')}.`,
  ]
  if (plan.skipped.length) lines.push(`Left out (missing rate or minimum): ${plan.skipped.join(', ')}.`)
  return lines.join(' ')
}

// Plain, general observations about the user's own numbers. Informational
// only: no product, security or allocation recommendations, ever.
export function moneyGuidance(m, { formatCents }) {
  const out = []
  const debts = m.accounts.filter((a) => a.kind === 'debt' && a.balanceCents > 0)

  for (const d of debts) {
    if (Number.isInteger(d.aprBps) && d.aprBps >= 1500) {
      const perMonth = monthlyInterest(d.balanceCents, d.aprBps)
      out.push({
        id: `apr:${d.id}`,
        text: `${d.name} charges about ${(d.aprBps / 100).toFixed(2).replace(/\.00$/, '')}% a year, roughly ${formatCents(perMonth)} of interest each month at today's balance. Interest at this level usually costs more than savings earn, which is why many people pay debts like this down first.`,
      })
    }
  }

  if (m.cancelCandidates.length) {
    out.push({
      id: 'cancel',
      text: `You've marked ${m.cancelCandidates.length} bill${m.cancelCandidates.length === 1 ? '' : 's'} as possible cancellations (${m.cancelCandidates.map((c) => c.name).join(', ')}). Cancelling ${m.cancelCandidates.length === 1 ? 'it' : 'them'} would free about ${formatCents(m.cancelSavings.monthlyCents)} a month, ${formatCents(m.cancelSavings.yearlyCents)} a year.`,
    })
  }

  if (m.subscriptionsMonthlyCents > 0) {
    out.push({
      id: 'bills-total',
      text: `Your tracked bills and subscriptions come to about ${formatCents(m.subscriptionsMonthlyCents)} a month, or ${formatCents(m.subscriptionsMonthlyCents * 12)} a year.`,
    })
  }

  const hasEmergencyGoal = m.goals.some((g) => /emergency|rainy|safety|cushion/i.test(g.name))
  if (!hasEmergencyGoal && (m.purchases.length > 0 || m.bills.length > 0)) {
    out.push({
      id: 'emergency',
      text: 'There is no emergency fund goal yet. A common rule of thumb is to set aside three to six months of essential spending; the right amount depends on how steady your income is and what you owe.',
    })
  }

  const over = m.budgets.filter((b) => b.over)
  for (const b of over) {
    out.push({ id: `over:${b.category}:${m.month}`, text: `${b.category} is over its budget this month: ${formatCents(b.spentCents)} spent of ${formatCents(b.monthlyCents)}.` })
  }

  const soon = m.bills.filter((b) => !b.paid && b.cadence === 'yearly' && b.daysUntil >= 0 && b.daysUntil <= 60 && b.amountCents > 0)
  if (soon.length) {
    out.push({
      id: 'yearly-soon',
      text: `Yearly bills are coming up in the next 60 days: ${soon.map((b) => `${b.name} (${formatCents(b.amountCents)}, ${b.dueOn})`).join('; ')}. Setting aside a twelfth each month is a common way to avoid a surprise.`,
    })
  }

  return out
}
