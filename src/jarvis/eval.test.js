import 'fake-indexeddb/auto'
import { writeFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { openStore } from '../core/store'
import { createLog } from '../core/log'
import { createAppRegistry } from '../modules'
import { buildRequest, planFromContent } from './jarvis'
import jarvisHandler from '../../api/jarvis.js'

// Routing eval (backlog T3.1). Calls the real model, so it only runs on demand:
//   JARVIS_EVAL=1 node --env-file=.env node_modules/vitest/vitest.mjs run src/jarvis/eval.test.js
// Costs a few cents. Set a fixed "now" so date expectations are exact.

const NOW = new Date(2026, 8, 18, 12, 0, 0) // Friday 2026-09-18, local

const call = (body) =>
  new Promise((resolve) => {
    const res = {
      code: 200,
      status(c) {
        this.code = c
        return this
      },
      json(obj) {
        resolve({ code: this.code, body: obj })
      },
    }
    delete process.env.APP_ACCESS_CODE
    jarvisHandler({ method: 'POST', headers: {}, body }, res)
  })

const isTracker = (step, id) => step.name === 'evergrove__log_tracker_entry' && String(step.args.tracker).toLowerCase().includes(id)
const has = (steps, name) => steps.some((s) => s.name === name)
const find = (steps, name) => steps.find((s) => s.name === name)
const lower = (v) => String(v ?? '').toLowerCase()

// Each case: what the user says, and a check over the planned tool calls.
const CASES = [
  ['ran for 30 minutes', (s, t) => s.some((x) => isTracker(x, 'body') && Number(x.args.values?.minutes) === 30) || s.some((x) => x.name === 'evergrove__practice_skill' && x.args.area === 'health')],
  ['I read for 20 minutes', (s) => s.some((x) => (isTracker(x, 'learning') || isTracker(x, 'mind')) || (x.name === 'evergrove__practice_skill' && x.args.area === 'mind'))],
  ['I spent $12.50 on lunch', (s) => Number(find(s, 'money__log_purchase')?.args.amount) === 12.5],
  ['spent 9 dollars on coffee yesterday', (s) => find(s, 'money__log_purchase')?.args.date === '2026-09-17' || (Number(find(s, 'money__log_purchase')?.args.amount) === 9 && !find(s, 'money__log_purchase')?.args.date)],
  ['set my dining budget to $200', (s) => Number(find(s, 'money__set_budget')?.args.amount) === 200 && lower(find(s, 'money__set_budget')?.args.category).includes('din')],
  ['add dentist tomorrow at 3pm', (s) => find(s, 'calendar__add_event')?.args.start === '2026-09-19T15:00'],
  ['put lunch with Alex on my calendar next Tuesday at noon', (s) => find(s, 'calendar__add_event')?.args.start === '2026-09-22T12:00'],
  ['a checkup a week from tomorrow at 10am', (s) => find(s, 'calendar__add_event')?.args.start === '2026-09-26T10:00'],
  ['tomorrow I have church at 9am and lunch at 1pm', (s) => s.filter((x) => x.name === 'calendar__add_event').map((x) => x.args.start).sort().join() === '2026-09-19T09:00,2026-09-19T13:00'],
  ['add a task to buy milk', (s) => lower(find(s, 'tasks__add_task')?.args.title).includes('milk')],
  ['remind me to call mom', (s) => lower(find(s, 'tasks__add_task')?.args.title).includes('mom')],
  ['I need to edit the sermon', (s) => has(s, 'tasks__add_task') && !has(s, 'calendar__add_event')],
  ['did my stretching today', (s) => lower(find(s, 'tasks__check_habit')?.args.habit).includes('stretch')],
  ['finished filing the taxes', (s) => lower(find(s, 'tasks__complete_task')?.args.task).includes('tax')],
  ['move dinner with Sam to Wednesday at 8pm', (s) => find(s, 'calendar__reschedule_event')?.args.start === '2026-09-23T20:00'],
  ['cancel dinner with Sam', (s) => has(s, 'calendar__cancel_event')],
  ['delete the taxes task', (s) => has(s, 'tasks__delete_task')],
  ['start a daily habit of drinking water in health', (s) => find(s, 'tasks__add_habit')?.args.area === 'health' && lower(find(s, 'tasks__add_habit')?.args.name).includes('water')],
  ['set a goal to run a 10k with milestones 3k, 5k and 10k', (s) => find(s, 'goals__create_goal')?.args.milestones?.length === 3],
  ['make me a tracker for houseplants with the plant name and how much water', (s) => has(s, 'evergrove__create_tracker')],
  ['pause my creativity area for now', (s) => find(s, 'evergrove__pause_area')?.args.area === 'creativity'],
  ["my mom's birthday is March 3rd", (s) => find(s, 'people__save_person')?.args.birthday === '03-03'],
  ['I called Sam today', (s) => has(s, 'people__log_contact')],
  ['slept 7 hours last night', (s) => s.some((x) => isTracker(x, 'health') && lower(x.args.values?.kind) === 'sleep')],
  ['meditated for 10 minutes', (s) => s.some((x) => isTracker(x, 'mind') || (x.name === 'evergrove__practice_skill' && x.args.area === 'inner'))],
  ['ran 3 miles and read 20 pages', (s) => s.length >= 2],
  // must NOT act
  ['move it to Friday', (s) => s.length === 0],
  ['how am I doing this week?', (s) => s.length === 0],
  ['save my passport number 123456789 in the vault', (s) => s.length === 0],
  ['I did nothing today', (s) => s.length === 0],
]

describe.skipIf(!process.env.JARVIS_EVAL)('Jarvis routing eval (real model)', () => {
  it('routes phrases to the right tools', { timeout: 300_000 }, async () => {
    const store = await openStore(`eval-${Math.random()}`)
    const log = createLog(store, { channelName: `eval-${Math.random()}` })
    const reg = createAppRegistry(log)
    const run = (n, a) => reg.invoke(n, a, { now: NOW, actor: 'user', approved: true })
    await run('tasks__add_habit', { name: 'Stretch', area: 'health' })
    await run('tasks__add_task', { title: 'File taxes', effort: 3 })
    await run('calendar__add_event', { title: 'Dinner with Sam', start: '2026-09-22T19:00' })
    await run('people__save_person', { name: 'Sam' })

    const failures = []
    let cost = 0
    for (const [say, check] of CASES) {
      const payload = buildRequest({ history: [{ role: 'user', text: say }], registry: reg, events: log.getEvents(), now: NOW })
      const r = await call(payload)
      let steps = []
      let text = ''
      if (r.code === 200) ({ steps, text } = planFromContent(r.body.content, reg))
      cost = r.body.spend?.spentUsd ?? cost
      let ok = false
      try {
        ok = r.code === 200 && !!check(steps)
      } catch {
        ok = false
      }
      if (!ok) failures.push({ say, code: r.code, calls: steps.map((s) => `${s.name} ${JSON.stringify(s.args)}`), text })
    }
    const passed = CASES.length - failures.length
    console.log(`\nJARVIS EVAL: ${passed}/${CASES.length} passed (${((passed / CASES.length) * 100).toFixed(0)}%), spend so far $${cost.toFixed(4)}`)
    for (const f of failures) console.log('FAIL:', JSON.stringify(f))
    writeFileSync('.eval-last.json', JSON.stringify({ passed, total: CASES.length, cost, failures }, null, 1))
    expect(passed / CASES.length).toBeGreaterThanOrEqual(0.9)
  })
})
