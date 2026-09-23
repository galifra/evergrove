import { getKv } from './store.js'

// Dollars per token. Unknown models are priced like Sonnet so the cap errs on
// the side of stopping early, never late.
const PRICES = {
  haiku: { input: 1 / 1e6, output: 5 / 1e6, cacheRead: 0.1 / 1e6, cacheWrite: 1.25 / 1e6 },
  sonnet: { input: 3 / 1e6, output: 15 / 1e6, cacheRead: 0.3 / 1e6, cacheWrite: 3.75 / 1e6 },
  opus: { input: 15 / 1e6, output: 75 / 1e6, cacheRead: 1.5 / 1e6, cacheWrite: 18.75 / 1e6 },
}

export function priceFor(model = '') {
  if (model.includes('haiku')) return PRICES.haiku
  if (model.includes('opus')) return PRICES.opus
  return PRICES.sonnet
}

export function costOf(usage = {}, model = '') {
  const p = priceFor(model)
  return (
    (usage.input_tokens || 0) * p.input +
    (usage.output_tokens || 0) * p.output +
    (usage.cache_read_input_tokens || 0) * p.cacheRead +
    (usage.cache_creation_input_tokens || 0) * p.cacheWrite
  )
}

export function capUsd() {
  const raw = Number(process.env.AI_MONTHLY_CAP_USD)
  return Number.isFinite(raw) && raw > 0 ? raw : 2
}

function monthKey(now = new Date()) {
  return `evergrove:usage:${now.toISOString().slice(0, 7)}`
}

function countKey(now = new Date()) {
  return `evergrove:usagecount:${now.toISOString().slice(0, 7)}`
}

// What the money was spent on. Every request says which of these it is; the total above is the
// sum, so a request with an unknown purpose still counts against the cap.
export const PURPOSES_TRACKED = ['chat', 'logging', 'weekly', 'opinion']
export const PURPOSE_LABELS = { chat: 'Chat with MOXIE', logging: 'Typed entries on the tree', weekly: 'Weekly write-up', opinion: 'Opinions you asked for' }

// Spend by purpose for one month, in dollars; purposes with nothing spent are left out.
export async function getSpendByPurpose(now = new Date()) {
  const out = {}
  for (const p of PURPOSES_TRACKED) {
    const v = Number((await getKv().get(`${monthKey(now)}:${p}`)) ?? 0)
    if (v > 0) out[p] = v
  }
  return out
}

// Spend and request count for the last few months, newest first, for the
// monthly cost review. Months with nothing recorded are left out, except the current one.
export async function getHistory(now = new Date(), months = 6) {
  const out = []
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    const spentUsd = Number((await getKv().get(monthKey(d))) ?? 0)
    const requests = Number((await getKv().get(countKey(d))) ?? 0)
    if (i > 0 && !spentUsd && !requests) continue
    out.push({
      month: d.toISOString().slice(0, 7),
      spentUsd,
      requests,
      avgPerRequestUsd: requests ? spentUsd / requests : null,
      byPurpose: await getSpendByPurpose(d),
    })
  }
  return { capUsd: capUsd(), rationAt: RATION_AT, purposeLabels: PURPOSE_LABELS, months: out }
}

export async function getSpend(now = new Date()) {
  const spent = Number((await getKv().get(monthKey(now))) ?? 0)
  const cap = capUsd()
  return { spentUsd: spent, capUsd: cap, month: now.toISOString().slice(0, 7), rationed: spent >= cap * RATION_AT, stopped: spent >= cap }
}

export async function budgetAllows(now = new Date()) {
  const { spentUsd, capUsd: cap } = await getSpend(now)
  return spentUsd < cap
}

export async function recordUsage(usage, model, now = new Date(), purpose = 'chat') {
  const cost = costOf(usage, model)
  if (cost <= 0) return getSpend(now)
  await getKv().incrbyfloat(monthKey(now), cost)
  // The same spend, counted again under what it was for, so the cost review can split it.
  await getKv().incrbyfloat(`${monthKey(now)}:${purpose}`, cost)
  await getKv().incrbyfloat(countKey(now), 1)
  return getSpend(now)
}

// Rationing (docs/v2/COST-PLAN.md). Optional AI (the weekly write-up, opinions) stops at 80% of the
// monthly cap so the chat, which matters more, keeps the last fifth to itself. Proactive AI, which
// is the weekly write-up, may also never take more than 10% of the cap. At 100% everything stops.
export const RATION_AT = 0.8
export const PROACTIVE_SHARE = 0.1

export async function optionalAllows(now = new Date()) {
  const { spentUsd, capUsd: cap } = await getSpend(now)
  return spentUsd < cap * RATION_AT
}

export async function proactiveAllows(now = new Date()) {
  const spent = Number((await getKv().get(`${monthKey(now)}:weekly`)) ?? 0)
  return spent < capUsd() * PROACTIVE_SHARE
}

// What he says when the money runs short, in plain words, so nothing fails quietly.
export const MESSAGES = {
  ration: "I'm on a short ration this month, so I'm keeping what's left for our chats. The weekly write-up and opinions pause until next month.",
  proactive: "I've already used my share of the month on weekly write-ups, so I'll leave that one for next month.",
  stopped: "I've used this month's AI allowance, so I can only do the quick commands until it resets on the 1st: undo, brief me, today, remember, forget and the weekly review. Everything in your apps still works.",
}
