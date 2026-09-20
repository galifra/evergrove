import { describe, it, expect } from 'vitest'
import { matchLocalIntent, HELP_TEXT } from './localIntents'

const type = (t) => matchLocalIntent(t)?.type ?? null

describe('local shortcuts (no AI call)', () => {
  it('recognizes undo in its plain forms', () => {
    for (const t of ['undo', 'Undo', 'undo that', 'undo it', 'please undo', 'undo the last one', 'undo the last action', 'undo.']) {
      expect(type(t), t).toBe('undo')
    }
  })

  it('recognizes the tomorrow briefing', () => {
    for (const t of ['brief me', 'Brief me on tomorrow', "what's tomorrow", "what's on tomorrow?", 'what do I have tomorrow?', 'give me a briefing', "tomorrow's schedule", 'briefing']) {
      expect(type(t), t).toBe('briefing')
    }
  })

  it('recognizes the today list', () => {
    for (const t of ["what's today", "what's on today?", 'what do I have today', "today's plan", 'my day', 'show my day', 'what needs me today?']) {
      expect(type(t), t).toBe('today')
    }
  })

  it('recognizes clear and help', () => {
    expect(type('clear')).toBe('clear')
    expect(type('clear chat')).toBe('clear')
    expect(type('help')).toBe('help')
    expect(type('what can you do?')).toBe('help')
  })

  it('leaves anything that is really a request for the AI', () => {
    for (const t of [
      'undo the dentist appointment', // a specific thing, not "the last action"
      'undo my last workout and log 20 minutes instead',
      'add dentist tomorrow at 3pm',
      'what is tomorrow going to be like for Sam',
      'brief me on the sermon',
      'clear my calendar for Friday',
      'help me plan a trip',
      'ran 3 miles today',
      "how's my day going to look if I move lunch",
      '',
      '   ',
    ]) {
      expect(type(t), t).toBeNull()
    }
  })

  it('never matches long messages, however they start', () => {
    expect(type('undo ' + 'x'.repeat(80))).toBeNull()
  })

  it('has help text that names the instant commands', () => {
    expect(HELP_TEXT).toMatch(/brief me/)
    expect(HELP_TEXT).toMatch(/undo/)
  })
})
