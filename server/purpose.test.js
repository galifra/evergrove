import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as sdk from '@anthropic-ai/sdk'
import handler from '../api/jarvis.js'
import { getKv } from './store.js'
import { getSpend, recordUsage, RATION_AT } from './usage.js'
import { PURPOSES, STATIC_SYSTEM, TOOL_RULES, isOptionalPurpose, systemForPurpose } from './prompt.js'

// Optional AI (the weekly polish and opinions): its own instructions, no tools, and it stops
// at 80% of the monthly cap while the chat carries on to 100% (P7.12, P7.13, P8.3).

vi.mock('@anthropic-ai/sdk', () => {
  const create = vi.fn(async () => ({ content: [{ type: 'text', text: 'A steady week, mostly Health. What would you repeat?' }], usage: { input_tokens: 1000, output_tokens: 100 } }))
  return { default: class { constructor() { this.messages = { create } } }, __create: create }
})

const create = sdk.__create
const post = (body) =>
  new Promise((resolve) => {
    const res = {
      code: 200,
      status(c) {
        this.code = c
        return this
      },
      json(obj) {
        resolve({ code: this.code, body: obj })
      },
    }
    handler({ method: 'POST', headers: {}, body }, res)
  })

const weekly = { purpose: 'weekly', messages: [{ role: 'user', content: 'Week of Sep 7 to Sep 13\nWhat grew:\nHealth (40 xp).' }], persona: { name: 'Sam', style: 'plain' } }
const chat = { messages: [{ role: 'user', content: 'ran 30 minutes' }], tools: [{ name: 'tasks__add_task', description: 'Add', input_schema: { type: 'object', properties: {} } }] }

beforeEach(async () => {
  delete process.env.APP_ACCESS_CODE
  process.env.VERCEL_ENV = 'preview'
  process.env.ANTHROPIC_API_KEY = 'test'
  process.env.AI_MONTHLY_CAP_USD = '2'
  create.mockClear()
  const month = new Date().toISOString().slice(0, 7)
  for (const k of [`evergrove:usage:${month}`, `evergrove:usagecount:${month}`, `evergrove:usage:${month}:weekly`, `evergrove:usage:${month}:opinion`, `evergrove:usage:${month}:chat`]) await getKv().set(k, 0)
})

describe('the instructions for optional uses', () => {
  it('there are exactly two, and they keep the voice and the boundaries but not the tool rules', () => {
    expect(Object.keys(PURPOSES).sort()).toEqual(['opinion', 'weekly'])
    expect(isOptionalPurpose('weekly')).toBe(true)
    expect(isOptionalPurpose('chat')).toBe(false)
    expect(isOptionalPurpose('constructor')).toBe(false)
    for (const p of Object.keys(PURPOSES)) {
      const sys = systemForPurpose(p)
      expect(sys).toContain('You are Jarvis')
      expect(sys).toContain('What you will not do')
      expect(sys).not.toContain(TOOL_RULES)
    }
    expect(systemForPurpose('opinion')).toMatch(/never give medical|Never diagnose/i)
  })
})

describe('/api/jarvis with a purpose', () => {
  it('answers a weekly polish without tools, with its own instructions, and returns text only', async () => {
    const r = await post(weekly)
    expect(r.code).toBe(200)
    expect(r.body.content).toEqual([{ type: 'text', text: 'A steady week, mostly Health. What would you repeat?' }])
    expect(r.body.purpose).toBe('weekly')
    const params = create.mock.calls[0][0]
    expect(params.tools).toBeUndefined()
    expect(params.tool_choice).toBeUndefined()
    expect(params.system[0].text).toBe(systemForPurpose('weekly'))
    expect(params.system[0].text).not.toBe(STATIC_SYSTEM)
    expect(params.system[1].text).toContain('"Sam"')
    expect(params.max_tokens).toBeLessThanOrEqual(500)
  })

  it('counts the spend under what it was for, as well as in the total', async () => {
    await post(weekly)
    const month = new Date().toISOString().slice(0, 7)
    expect(Number(await getKv().get(`evergrove:usage:${month}:weekly`))).toBeGreaterThan(0)
    expect(Number(await getKv().get(`evergrove:usage:${month}:chat`))).toBe(0)
    expect((await getSpend()).spentUsd).toBeGreaterThan(0)
  })

  it('refuses an unknown purpose, and a chat without tools still needs its tools', async () => {
    expect((await post({ ...weekly, purpose: 'anything' })).code).toBe(400)
    expect((await post({ messages: chat.messages })).code).toBe(400)
    expect(create).not.toHaveBeenCalled()
  })

  it('stops optional uses at 80% of the cap, says why, and still lets the chat through', async () => {
    await recordUsage({ input_tokens: 0, output_tokens: 340_000 }, 'claude-haiku-4-5') // $1.70 of $2.00
    const before = (await getSpend()).spentUsd
    expect(before).toBeCloseTo(1.7, 5)
    expect(before / 2).toBeGreaterThan(RATION_AT)
    const r = await post(weekly)
    expect(r.code).toBe(429)
    expect(r.body.ration).toBe(true)
    expect(r.body.error).toMatch(/short ration/)
    expect(create).not.toHaveBeenCalledWith(expect.objectContaining({ max_tokens: 500 }))
    const c = await post(chat)
    expect(c.code).toBe(200)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('exactly at 80% is refused and just under it is allowed', async () => {
    await recordUsage({ input_tokens: 0, output_tokens: 319_000 }, 'claude-haiku-4-5') // $1.595
    expect((await post(weekly)).code).toBe(200)
    await recordUsage({ input_tokens: 0, output_tokens: 1_000 }, 'claude-haiku-4-5') // now $1.60 (80%) plus what the first request cost
    expect((await post(weekly)).code).toBe(429)
  })

  it('at 100% everything stops, chat included', async () => {
    await recordUsage({ input_tokens: 0, output_tokens: 400_000 }, 'claude-haiku-4-5') // $2.00
    expect((await post(chat)).code).toBe(429)
    const r = await post(weekly)
    expect(r.code).toBe(429)
  })
})
