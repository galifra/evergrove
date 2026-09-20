import { describe, it, expect } from 'vitest'
import { askJarvis } from './jarvis.js'
import { matchLocalIntent } from './localIntents.js'
import { NEEDS_AI, RATION_TEXT } from './ration.js'
import { MESSAGES } from '../../../../server/usage.js'
import { replyFor } from './replies.js'

// When the month's AI allowance is used up (TP8): the quick commands and the templates keep
// working, and he says so in plain words instead of failing quietly.

const stub = (status, body) => async () => ({ ok: status < 400, status, json: async () => body })

describe('the plain words match the server\'s', () => {
  it('the notice in the chat is exactly what the server says', () => {
    expect(RATION_TEXT.ration).toBe(MESSAGES.ration)
    expect(RATION_TEXT.stopped).toBe(MESSAGES.stopped)
  })

  it('they say what is happening and what still works, in a friendly voice', () => {
    expect(MESSAGES.ration).toMatch(/short ration/)
    expect(MESSAGES.stopped).toMatch(/quick commands/)
    for (const m of Object.values(MESSAGES)) {
      expect(m).not.toMatch(/!|AI_MONTHLY_CAP|env|error|quota/i) // no shouting, no owner-only jargon
      expect(m.length).toBeLessThan(260)
    }
    expect(MESSAGES.stopped).toContain('resets on the 1st')
  })
})

describe('what the client makes of a refusal', () => {
  it('an allowance that is used up says so and is marked as stopped', async () => {
    await expect(askJarvis({}, stub(429, { error: MESSAGES.stopped, stopped: true }))).rejects.toMatchObject({ status: 429, stopped: true, ration: false, message: MESSAGES.stopped })
  })

  it('a paused optional extra is marked as a ration, not a stop', async () => {
    await expect(askJarvis({}, stub(429, { error: MESSAGES.ration, ration: true }))).rejects.toMatchObject({ status: 429, ration: true, stopped: false })
  })

  it('other failures are not mistaken for either', async () => {
    await expect(askJarvis({}, stub(502, { error: 'Could not reach the model.' }))).rejects.toMatchObject({ status: 502, ration: false, stopped: false })
  })
})

describe('with the allowance spent, everything that does not need the AI still works', () => {
  const LOCAL = [
    ['undo', 'undo'],
    ['brief me', 'briefing'],
    ["what's today", 'today'],
    ['clear', 'clear'],
    ['help', 'help'],
    ['remember that I run best in the morning', 'remember'],
    ['call me Sam', 'callme'],
    ['what do you remember about me', 'memories'],
    ['forget that', 'forget'],
    ['weekly review', 'weekly'],
    ['export my feedback', 'exportfeedback'],
  ]

  it('each quick command is understood on the device, so it never asks the server', () => {
    for (const [say, type] of LOCAL) expect(matchLocalIntent(say)?.type, say).toBe(type)
  })

  it('the only typed command that needs the AI is asking for an opinion', () => {
    const types = new Set(LOCAL.map(([, t]) => t))
    for (const t of NEEDS_AI) expect(types.has(t)).toBe(false)
    expect(NEEDS_AI).toEqual(['opinion'])
    expect(matchLocalIntent('what do you think')?.type).toBe('opinion')
  })

  it('the reply templates need no AI either: they are never blank', () => {
    for (const steps of [[], [{ status: 'done', result: 'Added.' }], [{ status: 'needs-approval' }], [{ status: 'error', result: 'Nope.' }]]) {
      expect(replyFor({ text: '', steps, seed: 'x' }).trim().length).toBeGreaterThan(3)
    }
  })
})
