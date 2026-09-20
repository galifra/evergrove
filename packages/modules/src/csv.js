import { createEvent } from '@evergrove/core/events.js'

// Bank CSV import for the Money app. Runs entirely on the device: the file is
// never uploaded. Only money that LEFT your account becomes a purchase (deposits
// and refunds are skipped), and ids are derived from the row's content, so
// importing the same file twice adds nothing.

export function parseCsv(text) {
  const src = String(text).replace(/^﻿/, '')
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      cell = ''
      if (row.some((x) => x.trim() !== '')) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell)
  if (row.some((x) => x.trim() !== '')) rows.push(row)
  return rows
}

const has = (h, re) => re.test(h.toLowerCase())

// Finds which column is which from the header row (or gives up with nulls).
export function detectColumns(header) {
  const idx = (re) => header.findIndex((h) => has(h, re))
  const debit = idx(/debit|withdraw|paid out|money out/)
  const credit = idx(/credit|deposit|paid in|money in/)
  return {
    date: idx(/^date|posted|trans.*date/),
    amount: idx(/^amount$|^amt$|amount/),
    debit: debit >= 0 && debit !== credit ? debit : -1,
    credit,
    merchant: idx(/merchant|payee|description|desc|name|memo|details/),
    category: idx(/categor/),
  }
}

export function parseAmountCents(raw) {
  let s = String(raw ?? '').trim()
  if (!s) return null
  let negative = false
  if (/^\(.*\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1)
  }
  if (/-$/.test(s)) {
    negative = true
    s = s.slice(0, -1)
  }
  if (s.startsWith('-')) {
    negative = true
    s = s.slice(1)
  }
  s = s.replace(/[$,\s]/g, '')
  if (!/^\d*\.?\d+$/.test(s)) return null
  const [whole, frac = ''] = s.split('.')
  const cents = Number(whole || 0) * 100 + Number((frac + '00').slice(0, 2))
  return negative ? -cents : cents
}

export function parseDate(raw) {
  const s = String(raw ?? '').trim()
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  let y, mo, d
  if (m) [, y, mo, d] = m
  else if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/))) {
    ;[, mo, d, y] = m
    if (y.length === 2) y = `20${y}`
  } else return null
  const dt = new Date(Number(y), Number(mo) - 1, Number(d))
  if (dt.getFullYear() !== Number(y) || dt.getMonth() !== Number(mo) - 1 || dt.getDate() !== Number(d)) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

const CATEGORY_HINTS = [
  [/grocer|market|kroger|whole foods|aldi|safeway|trader joe|costco|walmart supercenter/i, 'groceries'],
  [/restaurant|cafe|coffee|starbucks|mcdonald|pizza|taco|burger|doordash|grubhub|uber eats|chipotle|dining/i, 'dining'],
  [/uber|lyft|shell|exxon|chevron|bp |fuel|gas station|parking|transit|metro/i, 'transport'],
  [/netflix|spotify|hulu|disney|prime video|youtube|subscription|apple\.com\/bill|icloud/i, 'subscriptions'],
  [/pharmacy|cvs|walgreens|clinic|dental|doctor|hospital/i, 'health'],
  [/electric|water|utilit|internet|comcast|verizon|at&t|t-mobile|rent|mortgage|insurance/i, 'bills'],
  [/amazon|target|best buy|ebay|etsy/i, 'shopping'],
]

export function guessCategory(text) {
  for (const [re, cat] of CATEGORY_HINTS) if (re.test(text)) return cat
  return 'other'
}

function hash(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

// Turns parsed rows into purchase records plus a list of rows that were skipped
// and why. `spendSign` says how your bank marks money leaving: 'negative',
// 'positive', or 'auto' (whichever sign most rows use).
export function toPurchases(rows, { spendSign = 'auto' } = {}) {
  if (rows.length < 2) return { purchases: [], skipped: [], columns: null, spendSign }
  const cols = detectColumns(rows[0])
  const skipped = []
  if (cols.date < 0 || (cols.amount < 0 && cols.debit < 0)) {
    return { purchases: [], skipped: [{ row: 1, reason: 'Could not find date and amount columns in the header row.' }], columns: cols, spendSign }
  }

  const body = rows.slice(1).map((cells, i) => ({ cells, line: i + 2 }))

  let sign = spendSign
  if (sign === 'auto' && cols.amount >= 0 && cols.debit < 0) {
    const amounts = body.map((r) => parseAmountCents(r.cells[cols.amount])).filter((a) => a !== null && a !== 0)
    sign = amounts.filter((a) => a < 0).length >= amounts.filter((a) => a > 0).length ? 'negative' : 'positive'
  }

  const seen = new Map()
  const purchases = []
  for (const { cells, line } of body) {
    const date = parseDate(cells[cols.date])
    if (!date) {
      skipped.push({ row: line, reason: 'Unreadable date' })
      continue
    }
    let cents
    if (cols.debit >= 0) {
      const out = parseAmountCents(cells[cols.debit])
      const inn = cols.credit >= 0 ? parseAmountCents(cells[cols.credit]) : null
      if (!out && inn) {
        skipped.push({ row: line, reason: 'Money in, not a purchase' })
        continue
      }
      cents = out === null ? null : Math.abs(out)
    } else {
      const a = parseAmountCents(cells[cols.amount])
      if (a === null) {
        skipped.push({ row: line, reason: 'Unreadable amount' })
        continue
      }
      const spent = sign === 'negative' ? a < 0 : a > 0
      if (!spent) {
        skipped.push({ row: line, reason: 'Money in, not a purchase' })
        continue
      }
      cents = Math.abs(a)
    }
    if (!cents) {
      skipped.push({ row: line, reason: 'Zero or missing amount' })
      continue
    }
    const merchant = (cols.merchant >= 0 ? cells[cols.merchant] : '').trim().replace(/\s+/g, ' ').slice(0, 60)
    const given = cols.category >= 0 ? cells[cols.category].trim().toLowerCase().slice(0, 30) : ''
    const category = given || guessCategory(merchant)
    const base = `${date}|${cents}|${merchant.toLowerCase()}`
    const n = (seen.get(base) ?? 0) + 1 // two identical coffees on one day stay two purchases
    seen.set(base, n)
    purchases.push({ id: `csv:${hash(base)}:${n}`, date, amountCents: cents, merchant, category, line })
  }
  return { purchases, skipped, columns: cols, spendSign: sign }
}

export function purchaseEvent(p, now = new Date()) {
  return createEvent({
    id: p.id,
    type: 'money.purchase.logged',
    app: 'money',
    area: 'discipline',
    actor: 'import',
    occurredAt: `${p.date}T12:00:00.000Z`,
    now,
    data: { purchaseId: p.id, amountCents: p.amountCents, category: p.category, merchant: p.merchant || undefined, note: 'Imported from CSV', date: p.date },
  })
}
