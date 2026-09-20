import { describe, it, expect, beforeEach } from 'vitest'
import { speechSupported, startListening } from './speech'

let instance
class FakeRecognition {
  constructor() {
    instance = this
    this.started = false
    this.stopped = false
  }
  start() {
    this.started = true
  }
  stop() {
    this.stopped = true
    this.onend?.()
  }
}

const result = (transcript, isFinal) => Object.assign([{ transcript }], { isFinal })

beforeEach(() => {
  instance = null
  globalThis.window = { webkitSpeechRecognition: FakeRecognition }
  Object.defineProperty(globalThis, 'navigator', { value: { language: 'en-US' }, configurable: true })
})

describe('voice input', () => {
  it('is off when the browser has no speech recognition', () => {
    globalThis.window = {}
    expect(speechSupported()).toBe(false)
  })

  it('reports support and starts listening in the browser language', () => {
    expect(speechSupported()).toBe(true)
    startListening({ onText() {} })
    expect(instance.started).toBe(true)
    expect(instance.lang).toBe('en-US')
    expect(instance.interimResults).toBe(true)
  })

  it('streams interim words and marks the final transcript', () => {
    const seen = []
    startListening({ onText: (t, final) => seen.push([t, final]) })
    instance.onresult({ results: [result('add dentist', false)] })
    instance.onresult({ results: [result('add dentist', true), result(' tomorrow at 3', true)] })
    expect(seen).toEqual([
      ['add dentist', false],
      ['add dentist tomorrow at 3', true],
    ])
  })

  it('turns errors into plain sentences', () => {
    const errors = []
    startListening({ onText() {}, onError: (m) => errors.push(m) })
    instance.onerror({ error: 'not-allowed' })
    instance.onerror({ error: 'weird' })
    expect(errors[0]).toMatch(/permission was blocked/)
    expect(errors[1]).toMatch(/weird/)
  })

  it('the returned function stops listening and signals the end', () => {
    let ended = false
    const stop = startListening({ onText() {}, onEnd: () => (ended = true) })
    stop()
    expect(instance.stopped).toBe(true)
    expect(ended).toBe(true)
  })
})
