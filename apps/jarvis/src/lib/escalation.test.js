import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { openStore } from '@evergrove/core/store.js'
import { createLog } from '@evergrove/core/log.js'
import { createAppRegistry } from '@evergrove/rules/registry.js'
import { needsEscalation } from './jarvis'
import { DEFAULT_ESCALATION_MODEL, DEFAULT_MODEL, modelFor } from '../../../../server/models.js'
import { costOf } from '../../../../server/usage.js'

let reg
beforeEach(async () => {
  reg = createAppRegistry(createLog(await openStore(`esc-${Math.random()}`), { channelName: `esc-${Math.random()}` }))
})

const text = (t) => ({ type: 'text', text: t })
const call = (name, input) => ({ type: 'tool_use', id: 't1', name, input })

describe('when to double-check with a stronger model (3.3)', () => {
  it('a good tool call, or a plain answer, is left alone', () => {
    expect(needsEscalation({ content: [call('tasks__add_task', { title: 'Buy milk' })] }, reg)).toBeNull()
    expect(needsEscalation({ content: [text('You logged 3 things this week.')] }, reg)).toBeNull()
    expect(needsEscalation({ content: [text('Added.'), call('tasks__add_task', { title: 'x' })] }, reg)).toBeNull()
  })

  it('a clarifying question is the right answer, not a failure', () => {
    expect(needsEscalation({ content: [text('Which dinner do you mean?')] }, reg)).toBeNull()
  })

  it('no answer at all is retried', () => {
    expect(needsEscalation({ content: [] }, reg)).toBe('empty')
    expect(needsEscalation({ content: [text('   ')] }, reg)).toBe('empty')
    expect(needsEscalation({}, reg)).toBe('empty')
  })

  it('arguments that break the tool schema are retried', () => {
    expect(needsEscalation({ content: [call('money__log_purchase', { amount: 'lots', category: 'food' })] }, reg)).toBe('invalid-arguments')
    expect(needsEscalation({ content: [call('calendar__add_event', { title: 'x' })] }, reg)).toBe('invalid-arguments')
    expect(needsEscalation({ content: [call('tasks__add_task', { title: 'x', repeatEveryDays: 0 })] }, reg)).toBe('invalid-arguments')
  })

  it('an invented tool (the server reports how many it dropped) is retried', () => {
    expect(needsEscalation({ content: [text('Done')], dropped: 1 }, reg)).toBe('unknown-tool')
    expect(needsEscalation({ content: [call('nothing__at_all', {})] }, reg)).toBe('unknown-tool')
  })
})

describe('which model answers', () => {
  it('the cheap model by default, the stronger one only when asked to escalate', () => {
    expect(modelFor({}, {})).toBe(DEFAULT_MODEL)
    expect(modelFor({ escalate: false }, {})).toBe(DEFAULT_MODEL)
    expect(modelFor({ escalate: true }, {})).toBe(DEFAULT_ESCALATION_MODEL)
  })

  it('environment overrides are respected, and only a real boolean true escalates', () => {
    const env = { ANTHROPIC_MODEL: 'small-x', ANTHROPIC_ESCALATION_MODEL: 'big-y' }
    expect(modelFor({}, env)).toBe('small-x')
    expect(modelFor({ escalate: true }, env)).toBe('big-y')
    expect(modelFor({ escalate: 'true' }, env)).toBe('small-x')
    expect(modelFor({ escalate: 1 }, env)).toBe('small-x')
    expect(modelFor(undefined, env)).toBe('small-x')
  })

  it('a retry on the stronger model is priced on the safe side, so the cap still holds', () => {
    const usage = { input_tokens: 10_000, output_tokens: 500 }
    expect(costOf(usage, DEFAULT_ESCALATION_MODEL)).toBeGreaterThan(costOf(usage, DEFAULT_MODEL))
  })
})

describe('ready-made date phrases', () => {
  it('works out the relative phrases in code, so the model copies instead of adding', async () => {
    const { relativePhrases } = await import('./jarvis')
    const t = relativePhrases(new Date(2026, 8, 18, 12)) // Friday 2026-09-18
    expect(t).toContain('a week from tomorrow = 2026-09-26 (+8)')
    expect(t).toContain('a week from today / same day next week = 2026-09-25 (+7)')
    expect(t).toContain('in two weeks = 2026-10-02 (+14)')
    expect(t).toContain('end of the month = 2026-09-30')
    expect(t).toContain('the first of next month = 2026-10-01')
  })

  it('handles month and year boundaries and leap days', async () => {
    const { relativePhrases } = await import('./jarvis')
    const dec = relativePhrases(new Date(2026, 11, 28, 9))
    expect(dec).toContain('a week from tomorrow = 2027-01-05 (+8)')
    expect(dec).toContain('end of the month = 2026-12-31')
    expect(dec).toContain('the first of next month = 2027-01-01')
    expect(relativePhrases(new Date(2028, 1, 20))).toContain('end of the month = 2028-02-29')
  })
})
