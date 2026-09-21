import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TEMPLATES, allTemplateLines, pick, replyFor } from './replies.js'
import { BANNED, toneProblems } from './tone.js'
import { isSpeaking, speak, speakableReply, speakableText, speechOutSupported, stepIsPrivate, stopSpeaking } from './speak.js'

describe('reply templates (P5.4)', () => {
  it('never come back blank, whatever happened', () => {
    for (const steps of [[], [{ status: 'done' }], [{ status: 'needs-approval' }], [{ status: 'error', result: 'The amount has to be more than zero.' }], [{ status: 'suggest-only' }], [{ status: 'done' }, { status: 'done' }]]) {
      for (const seed of ['a', 'b', 'c', '', 'zzz']) expect(replyFor({ text: '', steps, seed }).trim().length, JSON.stringify(steps)).toBeGreaterThan(0)
    }
  })

  it('uses the assistant\'s own words when it has some', () => {
    expect(replyFor({ text: '  Added, and the dentist is at 3.  ', steps: [{ status: 'done' }] })).toBe('Added, and the dentist is at 3.')
  })

  it('picks the right kind of line for each outcome', () => {
    expect(TEMPLATES.done).toContain(replyFor({ text: '', steps: [{ status: 'done' }, { status: 'done' }], seed: 'x' }))
    expect(TEMPLATES.doneOne).toContain(replyFor({ text: '', steps: [{ status: 'done' }], seed: 'x' }))
    expect(TEMPLATES.approval).toContain(replyFor({ text: '', steps: [{ status: 'done' }, { status: 'needs-approval' }], seed: 'x' }))
    expect(TEMPLATES.suggestOnly).toContain(replyFor({ text: '', steps: [{ status: 'suggest-only' }], seed: 'x' }))
    expect(TEMPLATES.unsure).toContain(replyFor({ text: '', steps: [], seed: 'x' }))
  })

  it('states an error plainly, without doubling the full stop', () => {
    expect(replyFor({ text: '', steps: [{ status: 'error', result: 'The amount has to be more than zero.' }] })).toBe('That did not go through: The amount has to be more than zero.')
    expect(replyFor({ text: '', steps: [{ status: 'error' }] })).toBe('That did not go through: something went wrong.')
  })

  it('is stable for one request and varies across requests', () => {
    expect(pick(TEMPLATES.done, 'abc')).toBe(pick(TEMPLATES.done, 'abc'))
    const seen = new Set(['a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7', 'h8'].map((s) => pick(TEMPLATES.done, s)))
    expect(seen.size).toBeGreaterThan(1)
  })
})

describe('the mechanical tone check (P5.7)', () => {
  it('every fixed line Jarvis says is warm-safe: no emoji, no shouting, short, no scolding, no doctoring', () => {
    for (const line of allTemplateLines()) expect(toneProblems(line), line).toEqual([])
  })

  it('catches what it is meant to catch', () => {
    expect(toneProblems('Great work 🎉')).toContain('emoji')
    expect(toneProblems('Wow! Amazing! Yes!')).toContain('shouting')
    expect(toneProblems('')).toContain('blank')
    expect(toneProblems('x'.repeat(500))).toContain('too long')
    expect(toneProblems("You should have done that yesterday.")).toContain('banned phrase: you should have')
    expect(toneProblems('It sounds like you are depressed.')).toContain('banned phrase: you are depressed')
    expect(toneProblems('You should buy this fund.')).toContain('banned phrase: you should buy')
    expect(toneProblems('Four days without stretching. Want to lower the target?')).toEqual([])
  })

  it('has a real list of banned phrases, all lower case', () => {
    expect(BANNED.length).toBeGreaterThan(10)
    for (const b of BANNED) expect(b).toBe(b.toLowerCase())
  })
})

describe('what is spoken aloud (P5.5)', () => {
  const privateIds = new Set(['money', 'health', 'people', 'vault', 'mind', 'compass'])

  it('turns markdown, links, bullets and emoji into plain words, and caps the length', () => {
    expect(speakableText('**Done.** See https://x.test/a — it\'s in Tasks 🎉\n- one\n- two')).toBe("Done. See — it's in Tasks one two")
    expect(speakableText('x'.repeat(1000))).toHaveLength(400)
    expect(speakableText(null)).toBe('')
  })

  it('reads an ordinary reply as it is', () => {
    expect(speakableReply({ text: 'Added the dentist for tomorrow at 3.', steps: [{ name: 'calendar__add_event', status: 'done', moduleName: 'Calendar' }] }, { privateIds })).toBe('Added the dentist for tomorrow at 3.')
  })

  it('does not read private details aloud unless that app is shared', () => {
    const steps = [{ name: 'money__log_purchase', status: 'done', moduleName: 'Money', args: {} }]
    const text = 'Logged $12.50 for lunch at Taco Place.'
    expect(speakableReply({ text, steps }, { privateIds })).toBe('Done. The details are in Money.')
    expect(speakableReply({ text, steps }, { privateIds })).not.toMatch(/12\.50|Taco/)
    expect(speakableReply({ text, steps }, { privateIds, shared: ['money'] })).toBe(text)
  })

  it('treats a log in a private tracker as private, by id or by name', () => {
    const health = (tracker) => [{ name: 'evergrove__log_tracker_entry', status: 'done', moduleName: 'Evergrove', args: { tracker } }]
    expect(stepIsPrivate(health('health')[0], privateIds)).toBe(true)
    expect(stepIsPrivate(health('Health & diet')[0], privateIds)).toBe(true)
    expect(stepIsPrivate(health('body')[0], privateIds)).toBe(false)
    expect(stepIsPrivate(health('health')[0], privateIds, ['health'])).toBe(false)
    expect(speakableReply({ text: 'Logged 171.5.', steps: health('health') }, { privateIds })).toBe('Done. The details are in Evergrove.')
  })

  it('an action that failed is not reported as private work', () => {
    const steps = [{ name: 'money__log_purchase', status: 'error', moduleName: 'Money', args: {} }]
    expect(speakableReply({ text: 'That did not go through.', steps }, { privateIds })).toBe('That did not go through.')
  })
})

describe('speaking and stopping', () => {
  beforeEach(() => {
    globalThis.window = globalThis
    globalThis.SpeechSynthesisUtterance = class {
      constructor(text) { this.text = text }
    }
    const queue = []
    globalThis.speechSynthesis = {
      getVoices: () => [{ voiceURI: 'v1', name: 'One' }, { voiceURI: 'v2', name: 'Two' }],
      speak: vi.fn((u) => queue.push(u)),
      cancel: vi.fn(() => queue.splice(0)),
      _queue: queue,
    }
  })

  it('speaks with the chosen voice and a clamped speed, and can be stopped', () => {
    expect(speechOutSupported()).toBe(true)
    expect(speak('Hello there', { voiceURI: 'v2', rate: 5 })).toBe(true)
    const u = globalThis.speechSynthesis._queue[0]
    expect(u.text).toBe('Hello there')
    expect(u.voice.voiceURI).toBe('v2')
    expect(u.rate).toBe(2)
    expect(isSpeaking()).toBe(true)
    stopSpeaking()
    expect(isSpeaking()).toBe(false)
    expect(globalThis.speechSynthesis.cancel).toHaveBeenCalled()
  })

  it('says nothing for empty text, and starting a new line stops the old one', () => {
    expect(speak('')).toBe(false)
    speak('one')
    speak('two')
    expect(globalThis.speechSynthesis.cancel).toHaveBeenCalled()
    expect(globalThis.speechSynthesis._queue.map((u) => u.text)).toEqual(['two'])
  })

  it('reports that it ends and clears its state', () => {
    const onEnd = vi.fn()
    speak('bye', { onEnd })
    globalThis.speechSynthesis._queue[0].onend()
    expect(onEnd).toHaveBeenCalled()
    expect(isSpeaking()).toBe(false)
  })
})

describe('replies worked out on the device are read aloud too, and private ones only generally', () => {
  it('an ordinary local reply is spoken as written', () => {
    expect(speakableReply({ text: 'Noted: "I run best in the morning".', steps: [], private: false })).toBe('Noted: "I run best in the morning".')
  })

  it("today's list, a briefing or a weekly review built from private data is never read out", () => {
    const line = speakableReply({ text: 'Today:\n- Test Rent ($500.00) is overdue since Tue, Sep 1.', steps: [], private: true })
    expect(line).toBe('The details are on screen.')
    expect(line).not.toMatch(/Rent|500|overdue/)
  })
})
