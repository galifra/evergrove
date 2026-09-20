import 'fake-indexeddb/auto'
import { writeFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { openStore } from '@evergrove/core/store.js'
import { createLog } from '@evergrove/core/log.js'
import { createEvent } from '@evergrove/core/events.js'
import { createAppRegistry } from '@evergrove/rules/registry.js'
import { buildRequest } from './jarvis.js'
import { buildOpinionRequest, buildWeeklyPolishRequest } from './notes.js'
import jarvisHandler from '../../../../api/jarvis.js'

// Measures what each kind of request really costs, on an account that is well filled in (tasks,
// habits, events, bills, goals, notes to remember), and records it in docs/v2/COST-MEASURED.md and
// docs/v2/cost-measured.json, which the heavy-month simulation uses. On demand only (about 6 cents):
//   npm run measure

const NOW = new Date(2026, 8, 18, 12, 0, 0)
const call = (body) =>
  new Promise((resolve) => {
    const res = { code: 200, status(c) { this.code = c; return this }, json(obj) { resolve({ code: this.code, body: obj }) } }
    delete process.env.APP_ACCESS_CODE
    jarvisHandler({ method: 'POST', headers: {}, body }, res)
  })

const CHAT = [
  'ran for 30 minutes',
  'add dentist tomorrow at 3pm',
  'I spent $12 on lunch',
  'mark stretch done and add a task to file taxes friday',
  'move dinner with Sam to Wednesday at 7pm',
  'log 3 sets of 10 squats at 135',
  'how much have I spent on food this month',
  'paid the electric bill',
  'make me a tracker for houseplants',
  'I skipped stretching today',
]

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

describe.skipIf(!process.env.JARVIS_MEASURE)('cost measurement (real model)', () => {
  it('records tokens and dollars per request type', { timeout: 600_000 }, async () => {
    const log = createLog(await openStore(`m-${Math.random()}`), { channelName: `m-${Math.random()}` })
    const reg = createAppRegistry(log)
    const run = (n, a) => reg.invoke(n, a, { now: NOW, actor: 'user', approved: true })
    await run('tasks__add_habit', { name: 'Stretch', area: 'health' })
    await run('tasks__add_habit', { name: 'Read', area: 'mind' })
    for (const t of ['File taxes', 'Call the bank', 'Renew passport', 'Book flights']) await run('tasks__add_task', { title: t, due: '2026-09-25' })
    await run('calendar__add_event', { title: 'Dinner with Sam', start: '2026-09-22T19:00' })
    await run('calendar__add_event', { title: 'Dentist', start: '2026-09-28T10:00' })
    await run('calendar__add_event', { title: 'Yoga', start: '2026-09-21T18:00', repeat: 'weekly' })
    await run('money__add_bill', { name: 'Electric', amount: 90, cadence: 'monthly', dueDay: 25 })
    await run('money__add_bill', { name: 'Rent', amount: 1200, cadence: 'monthly', dueDay: 1 })
    await run('money__set_budget', { category: 'food', monthly: 400 })
    await run('goals__create_goal', { title: 'Write a book', area: 'craft', milestones: ['Outline', 'Draft one', 'Draft two'] })
    await run('people__save_person', { name: 'Sam' })
    for (const text of ['Runs best in the morning', 'Prefers short answers', 'Sister Dana lives in Denver', 'Trying to read 20 pages a day', 'Vegetarian', 'Works from home on Fridays', 'Wants to run a 10k in the spring', 'Calls the dog Biscuit']) {
      await run('memory__remember', { text })
    }
    await log.append(['health', 'craft', 'mind'].map((a, i) => createEvent({ type: 'skill.practiced', app: 'test', data: { domain: a, skillName: ['Running', 'Guitar', 'Reading'][i], xp: 12, text: 'x' }, occurredAt: new Date(2026, 8, 12 + i).toISOString() })))
    const events = () => log.getEvents()
    const persona = { style: 'plain', name: 'Sam' }

    const rows = { chat: [], weekly: [], opinion: [] }
    for (const say of CHAT) {
      const r = await call(buildRequest({ history: [{ role: 'user', text: say }], registry: reg, events: events(), persona, now: NOW }))
      expect(r.code, say).toBe(200)
      rows.chat.push(r.body.usage)
    }
    for (let i = 0; i < 2; i++) {
      const r = await call(buildWeeklyPolishRequest({ events: events(), persona, now: new Date(2026, 8, 20, 20) }))
      expect(r.code).toBe(200)
      rows.weekly.push(r.body.usage)
    }
    for (const topic of ['my week', '', 'my goals']) {
      const r = await call(buildOpinionRequest({ topic, registry: reg, events: events(), persona, now: NOW }))
      expect(r.code).toBe(200)
      rows.opinion.push(r.body.usage)
    }

    // The first chat turn after a change finds the cache empty (it writes it); the rest read it. The
    // recorded chat figures are the warm turns, because a cold turn is priced from them in the simulation.
    const coldFirst = rows.chat[0]
    rows.chat = rows.chat.filter((u) => u.cacheRead > 0)
    const summary = {}
    for (const [k, list] of Object.entries(rows)) {
      summary[k] = {
        n: list.length,
        model: list[0].model,
        input: Math.round(avg(list.map((u) => u.input))),
        cacheRead: Math.round(avg(list.map((u) => u.cacheRead))),
        cacheWrite: Math.round(avg(list.map((u) => u.cacheWrite))),
        output: Math.round(avg(list.map((u) => u.output))),
        costUsd: avg(list.map((u) => u.costUsd)),
        maxCostUsd: Math.max(...list.map((u) => u.costUsd)),
      }
    }
    const promptTokens = rows.chat.map((u) => u.input + u.cacheRead + u.cacheWrite)
    const cacheHits = rows.chat.length
    const out = { measuredAt: new Date().toISOString(), model: rows.chat[0].model, coldFirst, summary, chatPromptTokens: { min: Math.min(...promptTokens), max: Math.max(...promptTokens) }, chatCacheHits: `${cacheHits} of ${CHAT.length}` }
    writeFileSync('docs/v2/cost-measured.json', JSON.stringify(out, null, 2))
    const usd = (x) => `$${x.toFixed(4)}`
    writeFileSync(
      'docs/v2/COST-MEASURED.md',
      [
        '# Measured cost per request',
        '',
        `Real calls on ${out.model}, on a well-filled account (tasks, habits, events, bills, a goal, eight notes to remember). Recorded ${out.measuredAt.slice(0, 10)}. \`npm run measure\` repeats it (about 6 cents).`,
        '',
        '| Request | Calls | Fresh input | Cache read | Cache write | Output | Average cost | Most expensive |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |',
        ...Object.entries(summary).map(([k, s]) => `| ${k} | ${s.n} | ${s.input} | ${s.cacheRead} | ${s.cacheWrite} | ${s.output} | ${usd(s.costUsd)} | ${usd(s.maxCostUsd)} |`),
        '',
        `A chat turn's whole prompt is ${out.chatPromptTokens.min} to ${out.chatPromptTokens.max} tokens. The prompt cache was read on ${out.chatCacheHits} chat turns; the figures above are for those warm turns. ${coldFirst.cacheWrite > 0 ? `The first turn found the cache empty and cost ${usd(coldFirst.costUsd)} because it wrote ${coldFirst.cacheWrite} tokens.` : 'The cache was already warm from an earlier run, so no cold turn was measured; the simulation prices a cold turn from the token counts.'}`,
        '',
      ].join('\n')
    )
    expect(summary.chat.costUsd).toBeGreaterThan(0)
  })
})
