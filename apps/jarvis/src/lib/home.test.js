import 'fake-indexeddb/auto'
import { describe, it, expect } from 'vitest'
import { openStore } from '@evergrove/core/store.js'
import { createLog } from '@evergrove/core/log.js'
import { createAppRegistry } from '@evergrove/rules/registry.js'
import { deriveTasks } from '@evergrove/modules/tasks.js'
import { deriveToday } from '@evergrove/rules/today.js'
import { greeting, stepLink } from './home.js'
import { buildContext } from './jarvis.js'

describe('the greeting', () => {
  it('follows the time of day, in local time', () => {
    const at = (h) => new Date(2026, 4, 15, h)
    expect(greeting(at(3))).toBe('Good evening.')
    expect(greeting(at(7))).toBe('Good morning.')
    expect(greeting(at(11, 59))).toBe('Good morning.')
    expect(greeting(at(12))).toBe('Good afternoon.')
    expect(greeting(at(17))).toBe('Good afternoon.')
    expect(greeting(at(18))).toBe('Good evening.')
    expect(greeting(at(23))).toBe('Good evening.')
  })

  it('uses your name when it has one, and never a blank one', () => {
    expect(greeting(new Date(2026, 4, 15, 8), 'Sam')).toBe('Good morning, Sam.')
    expect(greeting(new Date(2026, 4, 15, 8), '  ')).toBe('Good morning.')
    expect(greeting(new Date(2026, 4, 15, 8), null)).toBe('Good morning.')
  })
})

describe('"Open in <app>" links', () => {
  const done = (name, args = {}) => ({ name, args, status: 'done' })

  it('points at the app that was touched', () => {
    expect(stepLink(done('tasks__add_task'))).toEqual({ label: 'Tasks', path: '/tasks' })
    expect(stepLink(done('calendar__add_event'))).toEqual({ label: 'Calendar', path: '/calendar' })
    expect(stepLink(done('money__log_purchase'))).toEqual({ label: 'Money', path: '/money' })
    expect(stepLink(done('goals__create_goal'))).toEqual({ label: 'Goals', path: '/goals' })
    expect(stepLink(done('people__save_person'))).toEqual({ label: 'People', path: '/people' })
  })

  it('finds the tracker an entry went to, by id or by name', () => {
    expect(stepLink(done('evergrove__log_tracker_entry', { tracker: 'body' }))).toEqual({ label: 'Body', path: '/body' })
    expect(stepLink(done('evergrove__log_tracker_entry', { tracker: 'Health & diet' }))).toEqual({ label: 'Health & diet', path: '/health' })
    expect(stepLink(done('evergrove__log_tracker_entry', { tracker: 'zzz-unknown' }))).toEqual({ label: 'the tracker', path: '/apps' })
  })

  it('sends tree actions to the tree, and app ideas to the directory', () => {
    expect(stepLink(done('evergrove__practice_skill'))).toEqual({ label: 'your tree', path: '/' })
    expect(stepLink(done('evergrove__request_app'))).toEqual({ label: 'app ideas', path: '/apps' })
    expect(stepLink(done('evergrove__create_tracker'))).toEqual({ label: 'Apps', path: '/apps' })
  })

  it('offers no link for something that did not run, or for an app it does not know', () => {
    expect(stepLink({ name: 'tasks__add_task', status: 'needs-approval' })).toBeNull()
    expect(stepLink({ name: 'tasks__add_task', status: 'error' })).toBeNull()
    expect(stepLink(done('mystery__thing'))).toBeNull()
    expect(stepLink(null)).toBeNull()
  })
})

describe('Jarvis and the apps are one log, instantly in step (T-P4)', () => {
  async function twoWindows() {
    const name = `two-${Math.random()}`
    const channel = `chan-${Math.random()}`
    const jarvisLog = createLog(await openStore(name), { channelName: channel })
    const appsLog = createLog(await openStore(name), { channelName: channel })
    return { jarvisLog, appsLog }
  }
  const settle = () => new Promise((r) => setTimeout(r, 60))

  it('a task added through Jarvis shows up in the Tasks app, and on the Today list, at once', async () => {
    const { jarvisLog, appsLog } = await twoWindows()
    const jarvis = createAppRegistry(jarvisLog)
    const now = new Date(2026, 4, 15, 12)
    const r = await jarvis.invoke('tasks__add_task', { title: 'Buy milk', due: '2026-05-15' }, { now, actor: 'jarvis' })
    expect(r.status).toBe('done')
    await settle()
    expect(deriveTasks(appsLog.getEvents(), now).open.map((t) => t.title)).toEqual(['Buy milk'])
    expect(deriveToday(appsLog.getEvents(), now).map((i) => i.text).join(' ')).toMatch(/Buy milk/)
  })

  it("a workout logged in the Body app changes what Jarvis knows on his next answer", async () => {
    const { jarvisLog, appsLog } = await twoWindows()
    const jarvis = createAppRegistry(jarvisLog)
    const apps = createAppRegistry(appsLog)
    const now = new Date(2026, 4, 15, 12)
    expect(buildContext(jarvis, jarvisLog.getEvents(), {}, now)).not.toMatch(/Running/)
    await apps.invoke('evergrove__log_tracker_entry', { tracker: 'body', values: { kind: 'Running', minutes: 30 } }, { now, actor: 'user' })
    await settle()
    expect(buildContext(jarvis, jarvisLog.getEvents(), {}, now)).toMatch(/Running/)
  })

  it('an undo in one place is an undo in the other', async () => {
    const { jarvisLog, appsLog } = await twoWindows()
    const jarvis = createAppRegistry(jarvisLog)
    const now = new Date(2026, 4, 15, 12)
    const r = await jarvis.invoke('tasks__add_task', { title: 'Call the bank' }, { now, actor: 'jarvis' })
    await settle()
    expect(deriveTasks(appsLog.getEvents(), now).open).toHaveLength(1)
    await jarvis.undo(r.commandId)
    await settle()
    expect(deriveTasks(appsLog.getEvents(), now).open).toHaveLength(0)
  })

  it('a change made while the other window is closed is there when it opens', async () => {
    const name = `late-${Math.random()}`
    const first = createLog(await openStore(name), { channelName: `c-${Math.random()}` })
    const jarvis = createAppRegistry(first)
    await jarvis.invoke('tasks__add_task', { title: 'While you were away' }, { now: new Date(2026, 4, 15, 12), actor: 'jarvis' })
    const later = createLog(await openStore(name), { channelName: `c-${Math.random()}` })
    await later.load()
    expect(deriveTasks(later.getEvents()).open.map((t) => t.title)).toEqual(['While you were away'])
  })
})
