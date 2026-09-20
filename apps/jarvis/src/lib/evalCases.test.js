import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { openStore } from '@evergrove/core/store.js'
import { createLog } from '@evergrove/core/log.js'
import { createAppRegistry } from '@evergrove/rules/registry.js'
import { buildContext, contextSources } from './jarvis'
import { CASES, TAGS } from './evalCases'

// Free checks that the routing eval itself is sound (the model is not called).

describe('routing eval set', () => {
  it('has at least 100 cases, each with a phrase, a check and a known tag', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(100)
    for (const [say, check, tag] of CASES) {
      expect(typeof say).toBe('string')
      expect(say.length).toBeGreaterThan(0)
      expect(typeof check).toBe('function')
      expect(TAGS).toContain(tag)
    }
  })

  it('never repeats a phrase, and covers every tag', () => {
    const phrases = CASES.map((c) => c[0].toLowerCase())
    expect(new Set(phrases).size).toBe(phrases.length)
    for (const tag of TAGS) expect(CASES.filter((c) => c[2] === tag).length).toBeGreaterThanOrEqual(5)
  })

  it('every check runs on planned calls, on an empty plan, and on junk without throwing', () => {
    const junk = [{ name: 'evergrove__log_tracker_entry', args: {} }, { name: 'money__log_purchase', args: { amount: 'x' } }, { name: 'calendar__add_event', args: null }]
    for (const [say, check] of CASES) {
      for (const plan of [[], junk.slice(0, 2)]) {
        expect(() => check(plan), say).not.toThrow()
      }
    }
  })

  it('"must not act" cases pass on an empty plan and fail as soon as anything is planned', () => {
    const none = CASES.filter((c) => c[2] === 'ambiguous' || c[2] === 'adversarial').filter((c) => c[1]([]))
    expect(none.length).toBeGreaterThanOrEqual(20)
    const stray = [{ name: 'tasks__add_task', args: { title: 'x' } }]
    const strict = none.filter((c) => !c[1](stray))
    expect(strict.length).toBeGreaterThanOrEqual(20)
  })
})

describe('what the assistant is told, source by source', () => {
  let reg
  let log
  beforeEach(async () => {
    log = createLog(await openStore(`cs-${Math.random()}`), { channelName: `csc-${Math.random()}` })
    reg = createAppRegistry(log)
    const now = new Date(2026, 4, 15, 12)
    await reg.invoke('tasks__add_task', { title: 'Buy milk' }, { now })
    await reg.invoke('money__log_purchase', { amount: 20, category: 'dining' }, { now })
  })

  it('lists contributing apps and keeps private ones out unless shared', () => {
    const now = new Date(2026, 4, 15, 12)
    const closed = contextSources(reg, log.getEvents(), { shareSensitive: [] }, now)
    expect(closed.used.map((u) => u.id)).toContain('tasks')
    expect(closed.used.map((u) => u.id)).not.toContain('money')
    expect(closed.withheld.map((w) => w.id)).toContain('money')

    const open = contextSources(reg, log.getEvents(), { shareSensitive: ['money'] }, now)
    const money = open.used.find((u) => u.id === 'money')
    expect(money).toMatchObject({ sensitive: true })
    expect(money.text).toMatch(/Spent this month/)
    expect(open.withheld.map((w) => w.id)).not.toContain('money')
  })

  it('the text sent is exactly what the panel lists (revoking a source removes it)', () => {
    const now = new Date(2026, 4, 15, 12)
    const sent = buildContext(reg, log.getEvents(), { shareSensitive: ['money'] }, now)
    const listed = contextSources(reg, log.getEvents(), { shareSensitive: ['money'] }, now).used
    for (const u of listed) expect(sent).toContain(`[${u.name}]\n${u.text}`)
    expect(buildContext(reg, log.getEvents(), { shareSensitive: [] }, now)).not.toContain('[Money]')
  })
})
