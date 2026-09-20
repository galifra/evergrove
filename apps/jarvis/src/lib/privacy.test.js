import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { openStore } from '@evergrove/core/store.js'
import { createLog } from '@evergrove/core/log.js'
import { createEvent } from '@evergrove/core/events.js'
import { createAppRegistry } from '@evergrove/rules/registry.js'
import { BUILTIN_TRACKERS, validateEntry } from '@evergrove/rules/trackers.js'
import { deriveEvergrove } from '@evergrove/rules/derive.js'
import { buildContext, buildRequest, contextSources } from './jarvis'

// Blocked-area data never appears in a model request (backlog T3.6, T5).
// The request is inspected as the exact JSON that would be sent.

const NOW = new Date(2026, 4, 15, 12)
let log
let reg
let seq = 0

beforeEach(async () => {
  log = createLog(await openStore(`pv-${Math.random()}`), { channelName: `pvc-${Math.random()}` })
  reg = createAppRegistry(log)
})

const entry = (tracker, values, when = NOW) => {
  const def = BUILTIN_TRACKERS.find((t) => t.id === tracker)
  const v = validateEntry(def, values)
  return log.append(createEvent({ id: `pv${seq++}`, type: 'tracker.entry', app: tracker, area: def.area, occurredAt: when.toISOString(), data: { trackerId: tracker, values: v.values } }))
}
const request = (shareSensitive = []) =>
  JSON.stringify(buildRequest({ history: [{ role: 'user', text: 'how am I doing?' }], registry: reg, events: log.getEvents(), shareSensitive, now: NOW }))

describe('private trackers stay out of what the AI is told', () => {
  beforeEach(async () => {
    await entry('mind', { kind: 'therapy', minutes: 50, mood: 3, notes: 'MINDNOTE' })
    await entry('health', { kind: 'weight', value: 171.5, notes: 'HEALTHNOTE' })
    await reg.invoke('evergrove__practice_skill', { area: 'health', skill: 'Running', xp: 12 }, { now: NOW })
  })

  it('leaves out the skills and xp grown by health and mind unless they are shared', () => {
    const ctx = buildContext(reg, log.getEvents(), {}, NOW)
    expect(ctx).toContain('Running 12xp')
    expect(ctx).not.toMatch(/therapy|weight|MINDNOTE|HEALTHNOTE/i)
    expect(ctx).toMatch(/Last 7 days: 1 entries, 12 xp/)
    expect(ctx).not.toMatch(/Mind & Learning/)
  })

  it('sharing one private app brings back only that one', () => {
    const ctx = buildContext(reg, log.getEvents(), { shareSensitive: ['mind'] }, NOW)
    expect(ctx).toMatch(/therapy/i)
    expect(ctx).not.toMatch(/weight/i)
    expect(ctx).toMatch(/Last 7 days: 2 entries/)
    const both = buildContext(reg, log.getEvents(), { shareSensitive: ['mind', 'health'] }, NOW)
    expect(both).toMatch(/therapy/i)
    expect(both).toMatch(/weight/i)
  })

  it('the panel lists exactly what is sent, and the entry text never travels', () => {
    for (const share of [[], ['mind'], ['mind', 'health']]) {
      const sent = request(share)
      expect(sent).not.toContain('MINDNOTE')
      expect(sent).not.toContain('HEALTHNOTE')
      const listed = contextSources(reg, log.getEvents(), { shareSensitive: share }, NOW).used.map((u) => u.text).join('\n')
      for (const line of listed.split('\n')) expect(JSON.parse(sent).context).toContain(line)
    }
  })

  it('does not say "no growth" when the only recent activity is private', async () => {
    const fresh = createAppRegistry(createLog(await openStore(`pv2-${Math.random()}`), { channelName: `pv2c-${Math.random()}` }))
    const only = [
      createEvent({ id: 'only1', type: 'tracker.entry', app: 'mind', area: 'mind', occurredAt: NOW.toISOString(), data: { trackerId: 'mind', values: { kind: 'therapy', minutes: 30 } } }),
    ]
    const ctx = buildContext(fresh, only, {}, NOW)
    expect(ctx).toMatch(/no growth logged in the shared apps \(private apps are not included\)/)
    expect(ctx).not.toMatch(/therapy/)
  })
})

describe('a tracker made by talking can be marked private', () => {
  it('create_tracker with private:true keeps what it grows out of the request', async () => {
    const r = await reg.invoke(
      'evergrove__create_tracker',
      { name: 'Panic log', area: 'inner', fields: [{ label: 'What happened', type: 'text', required: true }], skillName: 'Zebra Ritual', private: true },
      { now: NOW, approved: true }
    )
    expect(r.status).toBe('done')
    const state = deriveEvergrove(log.getEvents())
    expect(state.trackers.find((t) => t.id === 'panic-log').sensitive).toBe(true)
    await reg.invoke('evergrove__log_tracker_entry', { tracker: 'panic log', values: { what_happened: 'PRIVATE-DETAIL' } }, { now: NOW })
    expect(request([])).not.toContain('Zebra Ritual')
    expect(request(['panic-log'])).toContain('Zebra Ritual')
    expect(request(['panic-log'])).not.toContain('PRIVATE-DETAIL')
  })

  it('without the flag it is an ordinary tracker', async () => {
    await reg.invoke('evergrove__create_tracker', { name: 'Plant log', area: 'creativity', fields: [{ label: 'Plant', type: 'text', required: true }], skillName: 'Green Thumb' }, { now: NOW, approved: true })
    await reg.invoke('evergrove__log_tracker_entry', { tracker: 'plant log', values: { plant: 'fern' } }, { now: NOW })
    expect(request([])).toContain('Green Thumb')
  })
})
