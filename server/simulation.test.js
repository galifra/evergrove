import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { PROACTIVE_SHARE, RATION_AT, budgetAllows, capUsd, costOf, getHistory, getSpend, getSpendByPurpose, optionalAllows, proactiveAllows, recordUsage } from './usage.js'

// A month of heavy use, priced with the token counts measured on the real model (docs/v2/cost-measured.json,
// repeated by `npm run measure`), run through the same functions the server uses to record spend and to
// refuse requests. It shows what a heavy month costs and that the rationing rules do their job (P8.6, TP8).

const measured = JSON.parse(readFileSync(new URL('../docs/v2/cost-measured.json', import.meta.url), 'utf8'))
const MODEL = measured.model
const { chat, weekly, opinion } = measured.summary
const cacheable = chat.cacheRead + chat.cacheWrite // the tools and fixed instructions, cached together

// One chat turn, as tokens. The first turn of a session writes the cache (dearer), the rest read it.
const warm = { input_tokens: chat.input, output_tokens: chat.output, cache_read_input_tokens: cacheable }
const cold = { input_tokens: chat.input, output_tokens: chat.output, cache_creation_input_tokens: cacheable }
const weeklyUse = { input_tokens: weekly.input, output_tokens: weekly.output }
const opinionUse = { input_tokens: opinion.input, output_tokens: opinion.output }

/**
 * Lives a month day by day. Each day has `sessions` bursts of chat turns (15 turns a day in all); the
 * first of a burst finds the 5-minute cache gone. Four weekly write-ups and eight opinions on request.
 */
async function liveAMonth(month, { turnsPerDay = 15, sessions = 3 } = {}) {
  const log = { firstOptionalRefusal: null, firstChatRefusal: null, chatTurns: 0, chatRefused: 0, optionalDone: { weekly: 0, opinion: 0 }, optionalRefused: 0, over: 0 }
  const at = (day) => new Date(`${month}-${String(day).padStart(2, '0')}T12:00:00Z`)
  for (let day = 1; day <= 30; day++) {
    const now = at(day)
    // optional things go first in the evening, so chat gets no head start on them: the worst case for chat
    const optionalToday = []
    if (day % 7 === 0) optionalToday.push(['weekly', weeklyUse])
    if (day % 4 === 2 && log.optionalDone.opinion + optionalToday.filter((x) => x[0] === 'opinion').length < 8) optionalToday.push(['opinion', opinionUse])
    for (let i = 0; i < turnsPerDay; i++) {
      const firstOfSession = i % Math.ceil(turnsPerDay / sessions) === 0
      if (!(await budgetAllows(now))) {
        log.chatRefused += 1
        log.firstChatRefusal ??= day
        continue
      }
      await recordUsage(firstOfSession ? cold : warm, MODEL, now, 'chat')
      log.chatTurns += 1
    }
    for (const [purpose, usage] of optionalToday) {
      const ok = (await budgetAllows(now)) && (await optionalAllows(now)) && (purpose !== 'weekly' || (await proactiveAllows(now)))
      if (!ok) {
        log.optionalRefused += 1
        log.firstOptionalRefusal ??= day
        continue
      }
      await recordUsage(usage, MODEL, now, purpose)
      log.optionalDone[purpose] += 1
    }
  }
  const spend = await getSpend(at(30))
  return { ...log, spend, byPurpose: await getSpendByPurpose(at(30)) }
}

describe('what the measured request costs come to', () => {
  it('uses real, recorded numbers', () => {
    expect(measured.model).toMatch(/haiku/)
    expect(chat.n).toBeGreaterThanOrEqual(10)
    expect(cacheable).toBeGreaterThan(5000) // the tools and instructions really are cached
    expect(measured.chatCacheHits).toMatch(/^\d+ of \d+$/)
  })

  it('a warm chat turn is about a third of a cent, a cold one about a cent, and the writes and reads price as they should', () => {
    const w = costOf(warm, MODEL)
    const c = costOf(cold, MODEL)
    expect(w).toBeCloseTo(chat.costUsd, 3) // the recorded average was taken on warm turns
    expect(c).toBeGreaterThan(w * 2.5)
    expect(c).toBeLessThan(0.02)
    expect(costOf(weeklyUse, MODEL)).toBeLessThan(0.003)
    expect(costOf(opinionUse, MODEL)).toBeLessThan(0.004)
  })
})

describe('a heavy month (15 chats a day, four weekly write-ups, eight opinions)', () => {
  it('in two bursts a day it stays under the ration line too, so nothing is ever paused', async () => {
    const r = await liveAMonth('2035-03', { sessions: 2 })
    expect(r.chatRefused).toBe(0)
    expect(r.spend.spentUsd).toBeLessThan(capUsd() * RATION_AT)
    expect(r.optionalRefused).toBe(0)
    expect(r.optionalDone).toEqual({ weekly: 4, opinion: 8 })
    // the split adds up to the total, and the optional part is small
    const sum = Object.values(r.byPurpose).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(r.spend.spentUsd, 6)
    expect((r.byPurpose.weekly ?? 0) + (r.byPurpose.opinion ?? 0)).toBeLessThan(capUsd() * 0.05)
  })

  it('in three bursts a day it still stays under the $2 cap', async () => {
    const r = await liveAMonth('2035-08', { sessions: 3 })
    expect(r.chatRefused).toBe(0)
    expect(r.spend.spentUsd).toBeLessThan(capUsd())
  })

  it('scattered through the day (five cold starts) it can reach the cap, and the rules then protect the chat', async () => {
    const r = await liveAMonth('2035-04', { sessions: 5 })
    // Never past the cap by more than the one request that crossed it
    expect(r.spend.spentUsd).toBeLessThan(capUsd() + costOf(cold, MODEL))
    // Optional AI stopped first (at 80%), chat only later (at 100%), never the other way round
    if (r.firstChatRefusal) {
      expect(r.firstOptionalRefusal ?? 0).toBeGreaterThan(0)
      expect(r.firstOptionalRefusal).toBeLessThanOrEqual(r.firstChatRefusal)
    }
    expect(r.spend.rationed || r.spend.spentUsd < capUsd() * RATION_AT).toBe(true)
    // The weekly write-up never took more than a tenth of the cap
    expect(r.byPurpose.weekly ?? 0).toBeLessThanOrEqual(capUsd() * PROACTIVE_SHARE)
  })
})

describe('the ration rules, one step at a time', () => {
  const month = new Date('2035-05-10T12:00:00Z')
  const spendTo = async (target) => {
    const now = (await getSpend(month)).spentUsd
    // output tokens on the small model cost $5 per million
    if (target > now) await recordUsage({ input_tokens: 0, output_tokens: Math.round(((target - now) / 5) * 1e6) }, MODEL, month, 'chat')
  }

  it('everything is open at the start; optional things close at 80%; chat closes at 100%', async () => {
    expect(await optionalAllows(month)).toBe(true)
    expect(await budgetAllows(month)).toBe(true)
    await spendTo(1.59)
    expect(await optionalAllows(month)).toBe(true)
    await spendTo(1.6)
    expect(await optionalAllows(month)).toBe(false)
    expect(await budgetAllows(month)).toBe(true)
    expect((await getSpend(month)).rationed).toBe(true)
    expect((await getSpend(month)).stopped).toBe(false)
    await spendTo(1.99)
    expect(await budgetAllows(month)).toBe(true)
    await spendTo(2)
    expect(await budgetAllows(month)).toBe(false)
    expect((await getSpend(month)).stopped).toBe(true)
  })

  it('the weekly write-up alone stops at a tenth of the cap, whatever else is spent', async () => {
    const m = new Date('2035-06-10T12:00:00Z')
    expect(await proactiveAllows(m)).toBe(true)
    await recordUsage({ input_tokens: 0, output_tokens: 39_000 }, MODEL, m, 'weekly') // $0.195
    expect(await proactiveAllows(m)).toBe(true)
    await recordUsage({ input_tokens: 0, output_tokens: 2_000 }, MODEL, m, 'weekly') // $0.205
    expect(await proactiveAllows(m)).toBe(false)
    expect(await optionalAllows(m)).toBe(true) // opinions are still fine
  })

  it('the counter is one number shared by every app on the address', async () => {
    const m = new Date('2035-07-10T12:00:00Z')
    await recordUsage({ input_tokens: 100_000 }, MODEL, m, 'chat') // Jarvis
    await recordUsage({ input_tokens: 100_000 }, MODEL, m, 'logging') // the tree's typed entries
    const s = await getSpend(m)
    expect(s.spentUsd).toBeCloseTo(0.2, 6)
    expect(await getSpendByPurpose(m)).toEqual({ chat: expect.closeTo(0.1, 6), logging: expect.closeTo(0.1, 6) })
    const h = await getHistory(m, 2)
    expect(h.months[0].byPurpose).toEqual(await getSpendByPurpose(m))
    expect(h.purposeLabels.logging).toBeTruthy()
  })
})
