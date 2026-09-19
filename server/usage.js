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

export async function getSpend(now = new Date()) {
  const spent = Number((await getKv().get(monthKey(now))) ?? 0)
  return { spentUsd: spent, capUsd: capUsd(), month: now.toISOString().slice(0, 7) }
}

export async function budgetAllows(now = new Date()) {
  const { spentUsd, capUsd: cap } = await getSpend(now)
  return spentUsd < cap
}

export async function recordUsage(usage, model, now = new Date()) {
  const cost = costOf(usage, model)
  if (cost <= 0) return getSpend(now)
  await getKv().incrbyfloat(monthKey(now), cost)
  return getSpend(now)
}
