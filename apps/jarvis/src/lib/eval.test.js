import 'fake-indexeddb/auto'
import { writeFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { openStore } from '@evergrove/core/store.js'
import { createLog } from '@evergrove/core/log.js'
import { createAppRegistry } from '@evergrove/rules/registry.js'
import { buildRequest, planFromContent } from './jarvis'
import { CASES, TAGS } from './evalCases'
import jarvisHandler from '../../../../api/jarvis.js'

// Routing eval (backlog T3.1, T3.5). Calls the real model, so it only runs on demand:
//   JARVIS_EVAL=1 node --env-file=.env node_modules/vitest/vitest.mjs run src/jarvis/eval.test.js
// Costs roughly 60 cents for the full set. Records the misroute rate overall and
// per tag, plus latency and cost per request, in .eval-last.json.

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

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]

describe.skipIf(!process.env.JARVIS_EVAL)('Jarvis routing eval (real model)', () => {
  it('routes phrases to the right tools', { timeout: 900_000 }, async () => {
    const store = await openStore(`eval-${Math.random()}`)
    const log = createLog(store, { channelName: `eval-${Math.random()}` })
    const reg = createAppRegistry(log)
    const run = (n, a) => reg.invoke(n, a, { now: NOW, actor: 'user', approved: true })
    await run('tasks__add_habit', { name: 'Stretch', area: 'health' })
    await run('tasks__add_task', { title: 'File taxes', effort: 3 })
    await run('calendar__add_event', { title: 'Dinner with Sam', start: '2026-09-22T19:00' })
    await run('people__save_person', { name: 'Sam' })
    await run('calendar__add_event', { title: 'Yoga', start: '2026-09-21T18:00', repeat: 'weekly' })
    await run('calendar__add_event', { title: 'Dentist', start: '2026-09-28T10:00' })
    await run('goals__create_goal', { title: 'Write a book', area: 'craft', milestones: ['Outline'] })

    // JARVIS_EVAL_ONLY="week from tomorrow|walking dogs" runs just the phrases matching that pattern (cheap spot check).
    const only = process.env.JARVIS_EVAL_ONLY ? new RegExp(process.env.JARVIS_EVAL_ONLY, 'i') : null
    const cases = only ? CASES.filter((c) => only.test(c[0])) : CASES
    const failures = []
    const byTag = Object.fromEntries(TAGS.map((t) => [t, { passed: 0, total: 0 }]))
    const latencies = []
    let lastSpend = 0
    let firstSpend = null
    for (const [say, check, tag] of cases) {
      const payload = buildRequest({ history: [{ role: 'user', text: say }], registry: reg, events: log.getEvents(), now: NOW })
      const t0 = Date.now()
      const r = await call(payload)
      latencies.push(Date.now() - t0)
      let steps = []
      let text = ''
      if (r.code === 200) ({ steps, text } = planFromContent(r.body.content, reg))
      const spent = r.body.spend?.spentUsd
      if (typeof spent === 'number') {
        if (firstSpend === null) firstSpend = spent
        lastSpend = spent
      }
      let ok = false
      try {
        ok = r.code === 200 && !!check(steps)
      } catch {
        ok = false
      }
      byTag[tag].total += 1
      if (ok) byTag[tag].passed += 1
      else failures.push({ say, tag, code: r.code, calls: steps.map((s) => `${s.name} ${JSON.stringify(s.args)}`), text })
    }
    const passed = cases.length - failures.length
    const sorted = [...latencies].sort((a, b) => a - b)
    const cost = firstSpend === null ? 0 : lastSpend - firstSpend
    const report = {
      passed,
      total: cases.length,
      misrouteRate: +(1 - passed / cases.length).toFixed(3),
      byTag,
      latencyMs: { p50: pct(sorted, 50), p95: pct(sorted, 95), max: sorted[sorted.length - 1] },
      costUsd: +cost.toFixed(4),
      costPerRequestUsd: +(cost / cases.length).toFixed(5),
      spendSoFarUsd: lastSpend,
      failures,
    }
    console.log(`\nJARVIS EVAL: ${passed}/${cases.length} passed (${((passed / cases.length) * 100).toFixed(0)}%)`)
    console.log('By tag:', JSON.stringify(byTag))
    console.log(`Latency p50 ${report.latencyMs.p50}ms, p95 ${report.latencyMs.p95}ms. Cost $${report.costUsd} (${report.costPerRequestUsd}/request). Spend so far $${lastSpend}`)
    for (const f of failures) console.log('FAIL:', JSON.stringify(f))
    writeFileSync('.eval-last.json', JSON.stringify(report, null, 1))
    expect(passed / cases.length).toBeGreaterThanOrEqual(only ? 0 : 0.9)
  })
})
