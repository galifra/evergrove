import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { openStore } from '@evergrove/core/store.js'
import { createLog } from '@evergrove/core/log.js'
import { createAppRegistry } from '../registry'
import { deriveEvergrove } from '../derive'
import { appSpecMarkdown } from '../appSpec'
import { createEvent } from '@evergrove/core/events.js'

const NOW = new Date(2026, 4, 15, 12)
let log
let reg
beforeEach(async () => {
  log = createLog(await openStore(`ar-${Math.random()}`), { channelName: `arc-${Math.random()}` })
  reg = createAppRegistry(log)
})
const call = (n, a) => reg.invoke(n, a, { now: NOW, actor: 'jarvis' })

describe('asking for a whole new app', () => {
  it('saves a request that shows up in the derived state, and grows nothing', async () => {
    const r = await call('evergrove__request_app', {
      name: 'Meal planner',
      purpose: 'Plan the week of dinners and build a shopping list.',
      tracks: 'recipes, ingredients, days',
      screens: 'weekly grid, shopping list',
      area: 'health',
    })
    expect(r.status).toBe('done')
    const state = deriveEvergrove(log.getEvents())
    expect(state.appRequests).toHaveLength(1)
    expect(state.appRequests[0]).toMatchObject({ id: 'meal-planner', name: 'Meal planner', area: 'health' })
    expect(state.skills).toEqual({})
  })

  it('does not save the same idea twice', async () => {
    const args = { name: 'Meal planner', purpose: 'Plan dinners.' }
    await call('evergrove__request_app', args)
    const again = await call('evergrove__request_app', args)
    expect(again.status).toBe('error')
    expect(deriveEvergrove(log.getEvents()).appRequests).toHaveLength(1)
  })

  it('removing a request (an undo) takes it off the list', async () => {
    await call('evergrove__request_app', { name: 'Garden log', purpose: 'Track plants.' })
    const [{ eventId }] = deriveEvergrove(log.getEvents()).appRequests
    await log.append(createEvent({ type: 'event.reversed', app: 'evergrove', supersedes: eventId, data: {} }))
    expect(deriveEvergrove(log.getEvents()).appRequests).toEqual([])
  })

  it('is available to Jarvis as a tool that runs without asking', () => {
    const tool = reg.tools().find((t) => t.name === 'evergrove__request_app')
    expect(tool.tier).toBe('auto')
    expect(tool.input.required).toEqual(['name', 'purpose'])
  })
})

describe('the ready-to-build spec', () => {
  it('states the purpose and the rules every Evergrove app follows', () => {
    const md = appSpecMarkdown({ name: 'Meal planner', purpose: 'Plan dinners.', tracks: 'recipes', screens: 'weekly grid', area: 'health', requestedAt: '2026-05-15T12:00:00.000Z' })
    expect(md).toMatch(/^# App request: Meal planner/)
    expect(md).toMatch(/\*\*Purpose:\*\* Plan dinners\./)
    expect(md).toMatch(/Keeps track of:\*\* recipes/)
    expect(md).toMatch(/append-only event/)
    expect(md).toMatch(/permission tier/)
    expect(md).toMatch(/work offline/)
    expect(md).toMatch(/Requested 2026-05-15/)
  })

  it('leaves out lines the user did not give', () => {
    const md = appSpecMarkdown({ name: 'X', purpose: 'Y' })
    expect(md).not.toMatch(/Keeps track of/)
    expect(md).not.toMatch(/Life area/)
  })
})
