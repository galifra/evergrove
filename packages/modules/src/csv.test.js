import 'fake-indexeddb/auto'
import { describe, it, expect } from 'vitest'
import { openStore } from '@evergrove/core/store.js'
import { createLog } from '@evergrove/core/log.js'
import { parseCsv, parseAmountCents, parseDate, detectColumns, toPurchases, purchaseEvent, guessCategory } from './csv'
import { deriveMoney } from './money'

const NOW = new Date(2026, 4, 15, 12)

describe('csv parsing', () => {
  it('handles quotes, embedded commas and newlines, CRLF and a BOM', () => {
    const rows = parseCsv('﻿Date,Description,Amount\r\n2026-05-01,"Joe\'s, Diner ""Best""",-12.30\r\n2026-05-02,"Two\nlines",-5\r\n')
    expect(rows).toEqual([
      ['Date', 'Description', 'Amount'],
      ['2026-05-01', 'Joe\'s, Diner "Best"', '-12.30'],
      ['2026-05-02', 'Two\nlines', '-5'],
    ])
  })
  it('skips blank lines', () => {
    expect(parseCsv('a,b\n\n1,2\n\n')).toEqual([['a', 'b'], ['1', '2']])
  })
})

describe('amounts and dates', () => {
  it('reads every common way banks write an amount, exactly, in cents', () => {
    expect(parseAmountCents('$1,234.56')).toBe(123456)
    expect(parseAmountCents('-12.30')).toBe(-1230)
    expect(parseAmountCents('(12.30)')).toBe(-1230)
    expect(parseAmountCents('12.30-')).toBe(-1230)
    expect(parseAmountCents('.5')).toBe(50)
    expect(parseAmountCents('19.999')).toBe(1999) // never rounds up into a wrong cent
    expect(parseAmountCents('0.1')).toBe(10)
    expect(parseAmountCents('')).toBeNull()
    expect(parseAmountCents('abc')).toBeNull()
  })
  it('reads ISO and US dates and rejects impossible ones', () => {
    expect(parseDate('2026-05-01')).toBe('2026-05-01')
    expect(parseDate('5/1/2026')).toBe('2026-05-01')
    expect(parseDate('05/01/26')).toBe('2026-05-01')
    expect(parseDate('2026-02-30')).toBeNull()
    expect(parseDate('yesterday')).toBeNull()
  })
  it('finds columns by their header names', () => {
    expect(detectColumns(['Posted Date', 'Payee', 'Amount', 'Category'])).toMatchObject({ date: 0, merchant: 1, amount: 2, category: 3 })
    expect(detectColumns(['Date', 'Description', 'Debit', 'Credit'])).toMatchObject({ debit: 2, credit: 3, amount: -1 })
  })
  it('guesses a category from the merchant', () => {
    expect(guessCategory('STARBUCKS #123')).toBe('dining')
    expect(guessCategory('Kroger')).toBe('groceries')
    expect(guessCategory('Random Store')).toBe('other')
  })
})

describe('turning rows into purchases', () => {
  const bank = [
    'Date,Description,Amount',
    '2026-05-01,STARBUCKS,-4.50',
    '2026-05-01,STARBUCKS,-4.50', // a second, genuinely separate coffee
    '2026-05-02,PAYCHECK,2000.00', // money in
    '2026-05-03,KROGER,-82.19',
    '05/04/2026,Bad row,notanumber',
    'not a date,X,-1.00',
  ].join('\n')

  it('keeps spending, skips deposits and unreadable rows, and says why', () => {
    const r = toPurchases(parseCsv(bank))
    expect(r.spendSign).toBe('negative')
    expect(r.purchases.map((p) => [p.date, p.amountCents, p.merchant, p.category])).toEqual([
      ['2026-05-01', 450, 'STARBUCKS', 'dining'],
      ['2026-05-01', 450, 'STARBUCKS', 'dining'],
      ['2026-05-03', 8219, 'KROGER', 'groceries'],
    ])
    expect(r.skipped.map((s) => s.reason)).toEqual(['Money in, not a purchase', 'Unreadable amount', 'Unreadable date'])
    expect(new Set(r.purchases.map((p) => p.id)).size).toBe(3)
  })

  it('understands banks that list spending as positive, and debit/credit columns', () => {
    const positive = toPurchases(parseCsv('Date,Description,Amount\n2026-05-01,Shop,12.00\n2026-05-02,Refund,-3.00\n2026-05-03,Shop,9.00'))
    expect(positive.spendSign).toBe('positive')
    expect(positive.purchases.map((p) => p.amountCents)).toEqual([1200, 900])
    const split = toPurchases(parseCsv('Date,Description,Debit,Credit\n2026-05-01,Shop,12.00,\n2026-05-02,Pay,,500.00'))
    expect(split.purchases.map((p) => p.amountCents)).toEqual([1200])
  })

  it('reports a clear problem when the header is unrecognizable', () => {
    const r = toPurchases(parseCsv('foo,bar\n1,2'))
    expect(r.purchases).toEqual([])
    expect(r.skipped[0].reason).toMatch(/date and amount/)
  })
})

describe('importing into the log', () => {
  it('importing the same file twice adds nothing the second time', async () => {
    const log = createLog(await openStore(`c-${Math.random()}`), { channelName: `cc-${Math.random()}` })
    const csv = 'Date,Description,Amount\n2026-05-01,STARBUCKS,-4.50\n2026-05-01,STARBUCKS,-4.50\n2026-05-03,KROGER,-82.19'
    const events = () => toPurchases(parseCsv(csv)).purchases.map((p) => purchaseEvent(p, NOW))
    expect((await log.append(events())).length).toBe(3)
    expect((await log.append(events())).length).toBe(0)
    const m = deriveMoney(log.getEvents(), NOW)
    expect(m.thisMonth.totalCents).toBe(450 + 450 + 8219)
    expect(m.thisMonth.byCategory).toMatchObject({ dining: 900, groceries: 8219 })
  })

  it('imports count as purchases but never as "logged today"', () => {
    const [p] = toPurchases(parseCsv('Date,Description,Amount\n2026-05-01,Shop,-1.00')).purchases
    expect(purchaseEvent(p, NOW).actor).toBe('import')
  })
})
