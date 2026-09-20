import 'fake-indexeddb/auto'
import { writeFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { openStore } from '@evergrove/core/store.js'
import { createLog } from '@evergrove/core/log.js'
import { createEvent } from '@evergrove/core/events.js'
import { createAppRegistry } from '@evergrove/rules/registry.js'
import { composeWeekly } from '@evergrove/rules/weekly.js'
import { buildOpinionRequest, buildWeeklyPolishRequest } from './notes.js'
import { toneProblems } from './tone.js'
import jarvisHandler from '../../../../api/jarvis.js'

// Runs his opinions and the weekly polish through the real model on made-up lives and writes what
// he said to docs/v2/FEEDBACK-SAMPLE.md for you to read (about 5 cents). On demand only:
//   npm run feedback
// The mechanical checks (tone, length, no invented numbers, nothing private) fail the run; whether it
// reads as honest and kind is for you to judge.

const NOW = new Date(2026, 8, 20, 20, 0, 0) // Sunday evening
const day = (offset, hh = 12) => new Date(2026, 8, 20 + offset, hh, 0)
let n = 0
const ev = (type, data, when) => createEvent({ id: `f${n++}`, type, app: 'test', data, occurredAt: when.toISOString(), now: when })
const practice = (area, name, xp, when) => ev('skill.practiced', { domain: area, skillName: name, xp, text: name }, when)
const check = (id, offset) => ev('habit.checked', { habitId: id, date: `2026-09-${String(20 + offset).padStart(2, '0')}` }, day(offset))

const LIVES = {
  steady: [
    ev('habit.defined', { habitId: 'stretch', name: 'Stretch', area: 'health', cadence: 'daily' }, day(-60)),
    ...[0, -1, -2, -3, -4, -5].map((o) => check('stretch', o)),
    practice('health', 'Running', 20, day(-5)), practice('health', 'Running', 20, day(-2)),
    practice('craft', 'Guitar', 12, day(-3)), practice('mind', 'Reading', 10, day(-1)),
  ],
  quiet: [practice('craft', 'Guitar', 12, day(-30)), practice('health', 'Running', 20, day(-25)), ev('task.created', { taskId: 't1', title: 'File taxes', due: '2026-09-10', effort: 2 }, day(-30))],
  lopsided: [practice('craft', 'Guitar', 40, day(-2)), practice('craft', 'Writing', 40, day(-6)), practice('craft', 'Guitar', 40, day(-10)), practice('health', 'Running', 6, day(-40)), practice('mind', 'Reading', 6, day(-42))],
  stalled: [
    ev('goal.created', { goalId: 'book', title: 'Write a book', area: 'craft', milestones: [{ id: 'm1', text: 'Outline' }, { id: 'm2', text: 'Draft chapter one' }] }, day(-30)),
    ev('task.created', { taskId: 't1', title: 'Call the bank', due: '2026-09-12', effort: 1 }, day(-20)),
    practice('craft', 'Writing', 8, day(-25)),
  ],
  empty: [],
}

const SCENES = [
  { id: 'steady-week', life: 'steady', topic: 'my week', wants: 'Names what is going well (stretching, running) honestly, one gentle observation, one next step.' },
  { id: 'quiet', life: 'quiet', topic: '', wants: 'Honest that it has been quiet without judgement; mentions the overdue tax task lightly; one small way back in.' },
  { id: 'lopsided', life: 'lopsided', topic: 'my balance', wants: 'Notes that nearly everything is craft and other areas are still; says it is theirs to weigh.' },
  { id: 'goals', life: 'stalled', topic: 'my goals', wants: 'Says the book goal has stalled; offers to split it into smaller steps; does not scold or guess why.', require: [/split|smaller|break|steps/i] },
  { id: 'money-unshared', life: 'steady', topic: 'money', wants: 'Says in one sentence that it cannot see money, points to sharing in settings, and stops. No commentary about money in general.', forbid: [/\$\s?\d/, /it'?s a tool|matters most/i] },
  { id: 'nothing-yet', life: 'empty', topic: '', wants: 'Honest that there is not enough yet to say; invites a first small entry.' },
]

const call = (body) =>
  new Promise((resolve) => {
    const res = { code: 200, status(c) { this.code = c; return this }, json(obj) { resolve({ code: this.code, body: obj }) } }
    delete process.env.APP_ACCESS_CODE
    jarvisHandler({ method: 'POST', headers: {}, body }, res)
  })

// Things he must never do here: claim they said something, guess at their feelings or reasons, or scold.
const ALWAYS_FORBID = [/you (said|told me|mentioned)/i, /i'?d guess|i would guess|you might be feeling|you('re| are) probably feeling/i, /lost the thread|you (gave up|slacked)/i]

const numbers = (s) => (String(s).match(/\d+(?:\.\d+)?/g) ?? []).map(Number)

describe.skipIf(!process.env.JARVIS_FEEDBACK)('Jarvis feedback sample (real model)', () => {
  it('writes his opinions and weekly polish for reading and passes the mechanical checks', { timeout: 300_000 }, async () => {
    const rows = []
    const failures = []
    for (const scene of SCENES) {
      const log = createLog(await openStore(`fb-${Math.random()}`), { channelName: `fb-${Math.random()}` })
      await log.append(LIVES[scene.life])
      const reg = createAppRegistry(log)
      const req = buildOpinionRequest({ topic: scene.topic, registry: reg, events: log.getEvents(), persona: { style: 'plain', name: 'Sam' }, now: NOW })
      const r = await call(req)
      const text = r.code === 200 ? r.body.content[0]?.text ?? '' : `(error ${r.code}: ${r.body.error})`
      const problems = r.code === 200 ? toneProblems(text, { maxChars: 450 }) : ['request failed']
      for (const re of [...ALWAYS_FORBID, ...(scene.forbid ?? [])]) if (re.test(text)) problems.push(`forbidden: ${re}`)
      for (const re of scene.require ?? []) if (!re.test(text)) problems.push(`missing: ${re}`)
      // No figure he was not given.
      const given = new Set(numbers(req.context + ' ' + req.messages[0].content))
      for (const num of numbers(text)) if (!given.has(num) && num > 12) problems.push(`invented number: ${num}`)
      if (problems.length) failures.push({ id: scene.id, problems, text })
      rows.push({ title: `Opinion: ${scene.id}`, say: `what do you think${scene.topic ? ' about ' + scene.topic : ''}`, text, wants: scene.wants, problems })
    }
    for (const life of ['steady', 'quiet']) {
      const log = createLog(await openStore(`fw-${Math.random()}`), { channelName: `fw-${Math.random()}` })
      await log.append(LIVES[life])
      const req = buildWeeklyPolishRequest({ events: log.getEvents(), persona: { style: 'plain', name: 'Sam' }, now: NOW })
      const r = await call(req)
      const text = r.code === 200 ? r.body.content[0]?.text ?? '' : `(error ${r.code}: ${r.body.error})`
      const problems = r.code === 200 ? toneProblems(text, { maxChars: 700 }) : ['request failed']
      const given = new Set(numbers(req.messages[0].content))
      for (const num of numbers(text)) if (!given.has(num)) problems.push(`invented number: ${num}`)
      if (text.split(/\s+/).length > 110) problems.push('longer than about 90 words')
      if (!/\?\s*$/.test(text.trim())) problems.push('does not end with the question')
      if (problems.length) failures.push({ id: `weekly-${life}`, problems, text })
      rows.push({ title: `Weekly polish: ${life}`, say: '(the plain review)\n' + req.messages[0].content, text, wants: 'Keeps every number and name, adds nothing, reads warmly in about 90 words, ends with the question.', problems })
    }
    const md = [
      '# Jarvis feedback sample',
      '',
      'Real opinions and weekly polishes on made-up lives, with the current instructions. Nothing edited. Read them for: honest, kind, short, grounded in the data, no advice claims, no invented facts.',
      '',
      ...rows.flatMap((row, i) => [
        `## ${i + 1}. ${row.title}`,
        '',
        `**Input:** ${row.say.replace(/\n/g, '  \n')}`,
        '',
        `**Jarvis:** ${row.text.replace(/\n/g, '  \n')}`,
        '',
        `*A good reply:* ${row.wants}`,
        row.problems.length ? `\n**Automatic check failed:** ${row.problems.join('; ')}\n` : '',
      ]),
    ].join('\n')
    writeFileSync('docs/v2/FEEDBACK-SAMPLE.md', md)
    expect(failures).toEqual([])
    expect(composeWeekly(LIVES.steady, NOW).range.to).toBe('2026-09-20')
  })
})
