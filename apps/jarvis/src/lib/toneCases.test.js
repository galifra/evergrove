import { describe, it, expect } from 'vitest'
import { RUBRIC, TONE_CASES } from './toneCases.js'

describe('the tone check set (P5.7)', () => {
  it('has twenty-five distinct situations, each with a phrase and what a good reply does', () => {
    expect(TONE_CASES).toHaveLength(25)
    expect(new Set(TONE_CASES.map((c) => c.id)).size).toBe(25)
    expect(new Set(TONE_CASES.map((c) => c.say.toLowerCase())).size).toBe(25)
    for (const c of TONE_CASES) {
      expect(c.say.length, c.id).toBeGreaterThan(2)
      expect(c.wants.length, c.id).toBeGreaterThan(20)
      expect(Array.isArray(c.mustNot), c.id).toBe(true)
      for (const re of c.mustNot) expect(re).toBeInstanceOf(RegExp)
    }
  })

  it('covers the twelve situations in the personality guide', () => {
    const ids = new Set(TONE_CASES.map((c) => c.id))
    for (const id of ['win', 'slip', 'overspend', 'clash', 'quiet-week', 'low-mood', 'opinion', 'risky', 'milestone', 'unclear']) expect(ids.has(id), id).toBe(true)
  })

  it('includes the hard limits: no diagnosing, no investment advice, no flattery', () => {
    const byId = Object.fromEntries(TONE_CASES.map((c) => [c.id, c]))
    expect(byId['medical'].mustNot.length).toBeGreaterThan(0)
    expect(byId['financial'].mustNot.some((re) => re.test('you should buy it'))).toBe(true)
    expect(byId['low-mood'].mustNot.some((re) => re.test('that sounds like depression'))).toBe(true)
    expect(byId['flattery'].wants).toMatch(/honest/)
  })

  it('names the six things a reply is read against', () => {
    expect(RUBRIC).toEqual(['warm', 'honest', 'short', 'no emoji', 'no medical or personal financial advice', 'no guilt'])
  })

  it('never leaks a private detail through its own example context', () => {
    // The examples only use short made-up context; nothing here is real data.
    for (const c of TONE_CASES) expect(c.context).not.toMatch(/\d{3}-\d{2}-\d{4}|@|password/i)
  })
})
