import { describe, it, expect } from 'vitest'
import { costOf, budgetAllows, recordUsage, getSpend, getHistory, capUsd } from './usage.js'
import { authorize, checkAppCode, checkCronSecret, safeEqual } from './auth.js'

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
  it('keeps a monthly history with request counts and a cost per request', async () => {
    const now = new Date('2033-05-20T12:00:00Z')
    const prev = new Date('2033-04-02T12:00:00Z')
    await recordUsage({ input_tokens: 100_000, output_tokens: 10_000 }, 'claude-haiku-4-5', prev) // $0.15
    await recordUsage({ input_tokens: 100_000, output_tokens: 10_000 }, 'claude-haiku-4-5', prev)
    await recordUsage({ input_tokens: 200_000, output_tokens: 0 }, 'claude-haiku-4-5', now) // $0.20
    const h = await getHistory(now, 4)
    expect(h.capUsd).toBe(2)
    expect(h.months.map((m) => m.month)).toEqual(['2033-05', '2033-04'])
    expect(h.months[0]).toMatchObject({ requests: 1 })
    expect(h.months[0].spentUsd).toBeCloseTo(0.2, 6)
    expect(h.months[1].requests).toBe(2)
    expect(h.months[1].avgPerRequestUsd).toBeCloseTo(0.15, 6)
  })
  it('the current month is always listed, even before any spend', async () => {
    const h = await getHistory(new Date('2034-01-05T00:00:00Z'), 3)
    expect(h.months).toEqual([{ month: '2034-01', spentUsd: 0, requests: 0, avgPerRequestUsd: null, byPurpose: {} }])
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
  it('runs open only outside production when no code is configured', () => {
    delete process.env.APP_ACCESS_CODE
    process.env.VERCEL_ENV = 'production'
    expect(checkAppCode({ headers: {} })).toBe(false)
    expect(checkAppCode({ headers: { 'x-app-code': '' } })).toBe(false)
    process.env.VERCEL_ENV = 'preview'
    expect(checkAppCode({ headers: {} })).toBe(true)
    delete process.env.VERCEL_ENV
  })
  it('requires the exact code when configured', () => {
    process.env.APP_ACCESS_CODE = 'abc'
    expect(checkAppCode({ headers: { 'x-app-code': 'abc' } })).toBe(true)
    expect(checkAppCode({ headers: { 'x-app-code': 'abd' } })).toBe(false)
    expect(checkAppCode({ headers: {} })).toBe(false)
    delete process.env.APP_ACCESS_CODE
  })
})

describe('cron secret and constant-time compare', () => {
  it('safeEqual matches only identical strings, including different lengths', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'abcd')).toBe(false)
    expect(safeEqual('', 'a')).toBe(false)
  })
  it('the cron endpoint is closed when no secret is configured', () => {
    delete process.env.CRON_SECRET
    expect(checkCronSecret({ headers: { authorization: 'Bearer ' } })).toBe(false)
    expect(checkCronSecret({ headers: {} })).toBe(false)
  })
  it('accepts only the exact bearer token', () => {
    process.env.CRON_SECRET = 's3cret'
    expect(checkCronSecret({ headers: { authorization: 'Bearer s3cret' } })).toBe(true)
    expect(checkCronSecret({ headers: { authorization: 'Bearer s3cre' } })).toBe(false)
    expect(checkCronSecret({ headers: { authorization: 's3cret' } })).toBe(false)
    delete process.env.CRON_SECRET
  })
})

describe('brute-force lockout', () => {
  const call = async (code, ip = '9.9.9.9') => {
    const res = {
      code: 200,
      status(c) {
        this.code = c
        return this
      },
      json() {},
    }
    const ok = await authorize({ headers: { 'x-app-code': code, 'x-forwarded-for': ip } }, res)
    return { ok, code: res.code }
  }

  it('lets the right code through and counts nothing against it', async () => {
    process.env.APP_ACCESS_CODE = 'right-code'
    for (let i = 0; i < 30; i++) expect((await call('right-code', '1.1.1.1')).ok).toBe(true)
  })

  it('refuses an address after 20 wrong codes, even if the next one is right', async () => {
    process.env.APP_ACCESS_CODE = 'right-code'
    for (let i = 0; i < 20; i++) expect((await call(`guess-${i}`, '2.2.2.2')).code).toBe(401)
    const locked = await call('right-code', '2.2.2.2')
    expect(locked).toEqual({ ok: false, code: 429 })
  })

  it('only locks out the guesser, not everyone else', async () => {
    process.env.APP_ACCESS_CODE = 'right-code'
    for (let i = 0; i < 20; i++) await call(`guess-${i}`, '3.3.3.3')
    expect((await call('right-code', '4.4.4.4')).ok).toBe(true)
  })
})
