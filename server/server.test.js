import { describe, it, expect } from 'vitest'
import { costOf, budgetAllows, recordUsage, getSpend, capUsd } from './usage.js'
import { checkAppCode } from './auth.js'

describe('AI spend meter', () => {
  it('prices Haiku usage correctly', () => {
    const c = costOf({ input_tokens: 1_000_000, output_tokens: 1_000_000 }, 'claude-haiku-4-5-20251001')
    expect(c).toBeCloseTo(6, 5)
  })
  it('prices unknown models like Sonnet (errs on the expensive side)', () => {
    expect(costOf({ input_tokens: 1_000_000 }, 'mystery-model')).toBeCloseTo(3, 5)
  })
  it('blocks calls once the monthly cap is reached', async () => {
    delete process.env.AI_MONTHLY_CAP_USD
    const month = new Date('2031-03-10T00:00:00Z')
    expect(capUsd()).toBe(2)
    expect(await budgetAllows(month)).toBe(true)
    await recordUsage({ input_tokens: 1_000_000, output_tokens: 250_000 }, 'claude-haiku-4-5', month) // $2.25
    expect(await budgetAllows(month)).toBe(false)
    const { spentUsd } = await getSpend(month)
    expect(spentUsd).toBeGreaterThanOrEqual(2)
    expect(await budgetAllows(new Date('2031-04-01T00:00:00Z'))).toBe(true)
  })
  it('honors a custom cap', () => {
    process.env.AI_MONTHLY_CAP_USD = '5'
    expect(capUsd()).toBe(5)
    delete process.env.AI_MONTHLY_CAP_USD
  })
})

describe('app access code', () => {
  it('allows everything when no code is configured', () => {
    delete process.env.APP_ACCESS_CODE
    expect(checkAppCode({ headers: {} })).toBe(true)
  })
  it('requires the exact code when configured', () => {
    process.env.APP_ACCESS_CODE = 'abc'
    expect(checkAppCode({ headers: { 'x-app-code': 'abc' } })).toBe(true)
    expect(checkAppCode({ headers: { 'x-app-code': 'abd' } })).toBe(false)
    expect(checkAppCode({ headers: {} })).toBe(false)
    delete process.env.APP_ACCESS_CODE
  })
})
