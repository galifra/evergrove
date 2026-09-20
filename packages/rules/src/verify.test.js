import { describe, it, expect } from 'vitest'
import { createEvent } from '@evergrove/core/events.js'
import { verifyLog, describeVerification } from './verify'

const practice = (id, xp, extra = {}) =>
  createEvent({ id, type: 'skill.practiced', app: 'evergrove', area: 'health', data: { domain: 'health', skillName: 'Running', xp }, ...extra })

describe('the data integrity check', () => {
  it('passes a healthy log and proves the tree rebuilds the same way in any order', () => {
    const a = practice('a', 10, { occurredAt: '2026-01-01T10:00:00.000Z' })
    const b = practice('b', 5, { occurredAt: '2026-01-02T10:00:00.000Z' })
    const undo = createEvent({ id: 'u', type: 'event.reversed', app: 'evergrove', supersedes: 'b', data: {} })
    const r = verifyLog([a, b, undo])
    expect(r).toMatchObject({ total: 3, duplicates: 0, corrections: 1, pendingCorrections: 0, effective: 1, rebuildsIdentically: true, from: '2026-01-01' })
    expect(r.invalid).toEqual([])
    expect(describeVerification(r)).toMatch(/All events are valid.*rebuilds identically/)
  })

  it('reports a damaged event without letting it break the rest of the check', () => {
    const bad = { ...practice('x', 1), type: 'NoDots' }
    const r = verifyLog([practice('a', 10), bad])
    expect(r.invalid).toHaveLength(1)
    expect(r.invalid[0]).toMatchObject({ id: 'x', problem: 'bad type' })
    expect(r.rebuildsIdentically).toBe(true)
    expect(describeVerification(r)).toMatch(/1 invalid/)
  })

  it('a correction whose target has not synced yet is noted, not called an error', () => {
    const undo = createEvent({ id: 'u', type: 'event.reversed', app: 'evergrove', supersedes: 'not-here-yet', data: {} })
    const r = verifyLog([undo])
    expect(r.pendingCorrections).toBe(1)
    expect(describeVerification(r)).toMatch(/waiting for the event they correct/)
  })

  it('handles an empty log', () => {
    const r = verifyLog([])
    expect(r).toMatchObject({ total: 0, rebuildsIdentically: true, from: null })
    expect(describeVerification(r)).toMatch(/^0 events\./)
  })
})
