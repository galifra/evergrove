import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { openStore } from '../core/store'
import { createLog } from '../core/log'
import { createAppRegistry } from './index'
import { deriveTasks } from './tasks'
import { deriveEvergrove } from '../evergrove/derive'
import { deriveToday } from '../evergrove/today'

const NOW = new Date(2026, 4, 15, 12) // Fri 2026-05-15
let log
let reg
beforeEach(async () => {
  log = createLog(await openStore(`tr-${Math.random()}`), { channelName: `trc-${Math.random()}` })
  reg = createAppRegistry(log)
})
const call = (n, a, opts = {}) => reg.invoke(n, a, { now: NOW, ...opts })
const tasks = (now = NOW) => deriveTasks(log.getEvents(), now)

describe('repeating tasks', () => {
  it('first due date is one interval out unless one is given', async () => {
    const r = await call('tasks__add_task', { title: 'Clean gutters', repeatEveryDays: 90 })
    expect(r.summary).toMatch(/repeating task \(every 90 days\)/)
    expect(tasks().open[0]).toMatchObject({ title: 'Clean gutters', due: '2026-08-13', repeatEveryDays: 90 })
    await call('tasks__add_task', { title: 'Water plants', repeatEveryDays: 7, due: '2026-05-15' })
    expect(tasks().open.find((t) => t.title === 'Water plants').due).toBe('2026-05-15')
  })

  it('completing one keeps it open with the next date, and still grows the tree each time', async () => {
    await call('tasks__add_task', { title: 'Water plants', repeatEveryDays: 7, due: '2026-05-15' })
    const done = await call('tasks__complete_task', { task: 'plants' })
    expect(done.status).toBe('done')
    expect(done.summary).toMatch(/comes back on 2026-05-22/)
    const t = tasks().open[0]
    expect(t.due).toBe('2026-05-22')
    expect(t.timesDone).toBe(1)
    expect(tasks().doneToday.map((x) => x.title)).toEqual(['Water plants'])

    const next = new Date(2026, 4, 22, 12)
    await call('tasks__complete_task', { task: 'plants' }, { now: next })
    expect(tasks(next).open[0].due).toBe('2026-05-29')
    expect(deriveEvergrove(log.getEvents()).skills.discipline['getting-things-done'].xp).toBe(4)
  })

  it('a second completion on the same day changes nothing', async () => {
    await call('tasks__add_task', { title: 'Water plants', repeatEveryDays: 7, due: '2026-05-15' })
    await call('tasks__complete_task', { task: 'plants' })
    const before = log.getEvents().length
    const again = await call('tasks__complete_task', { task: 'plants' })
    expect(again.summary).toMatch(/already done today/)
    expect(log.getEvents().filter((e) => e.type === 'task.completed')).toHaveLength(1)
    expect(log.getEvents().length).toBeGreaterThanOrEqual(before)
  })

  it('undoing a completion puts the old date back', async () => {
    await call('tasks__add_task', { title: 'Water plants', repeatEveryDays: 7, due: '2026-05-15' })
    const r = await call('tasks__complete_task', { task: 'plants' })
    expect(tasks().open[0].due).toBe('2026-05-22')
    await reg.undo(r.commandId)
    expect(tasks().open[0].due).toBe('2026-05-15')
    expect(tasks().open[0].timesDone).toBe(0)
    expect(tasks().doneToday).toEqual([])
  })

  it('shows up in Today when it comes due', async () => {
    await call('tasks__add_task', { title: 'Water plants', repeatEveryDays: 7, due: '2026-05-15' })
    expect(deriveToday(log.getEvents(), NOW).map((i) => i.text).join(' ')).toMatch(/Water plants/)
    await call('tasks__complete_task', { task: 'plants' })
    expect(deriveToday(log.getEvents(), NOW).map((i) => i.text).join(' ')).not.toMatch(/Water plants/)
  })

  it('a normal task still closes for good', async () => {
    await call('tasks__add_task', { title: 'File taxes' })
    await call('tasks__complete_task', { task: 'taxes' })
    expect(tasks().open).toEqual([])
  })

  it('rejects an interval that is out of range', async () => {
    expect((await call('tasks__add_task', { title: 'x', repeatEveryDays: 0 })).status).toBe('error')
    expect((await call('tasks__add_task', { title: 'x', repeatEveryDays: 5000 })).status).toBe('error')
  })
})

describe('tasks linked to a goal', () => {
  beforeEach(async () => {
    await call('goals__create_goal', { title: 'Run a 10k', area: 'health' })
  })

  it('links by goal title and completing it grows that goal on the tree', async () => {
    const r = await call('tasks__add_task', { title: 'Buy running shoes', goal: 'run', effort: 2 })
    expect(r.summary).toMatch(/toward "Run a 10k"/)
    expect(tasks().open[0].goalId).toBeTruthy()
    await call('tasks__complete_task', { task: 'shoes' })
    expect(deriveEvergrove(log.getEvents()).skills.health['run-a-10k'].xp).toBe(4)
  })

  it('refuses an unknown goal instead of guessing', async () => {
    const r = await call('tasks__add_task', { title: 'Something', goal: 'learn piano' })
    expect(r.status).toBe('error')
    expect(tasks().all).toHaveLength(0)
  })
})
