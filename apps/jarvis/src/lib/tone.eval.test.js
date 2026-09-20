import 'fake-indexeddb/auto'
import { writeFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { openStore } from '@evergrove/core/store.js'
import { createLog } from '@evergrove/core/log.js'
import { createAppRegistry } from '@evergrove/rules/registry.js'
import { buildRequest, planFromContent } from './jarvis'
import { toneProblems } from './tone.js'
import { RUBRIC, TONE_CASES } from './toneCases.js'
import jarvisHandler from '../../../../api/jarvis.js'

// Runs the 25 tone situations through the real model and writes what he said to
// docs/v2/TONE-SAMPLE.md for a person to read (about 10 cents). On demand only:
//   npm run tone
// The mechanical checks (no emoji, no shouting, nothing banned, nothing a case
// forbids) fail the run; whether the replies feel warm is for you to judge.

const NOW = new Date(2026, 8, 20, 9, 0, 0)
const call = (body) =>
  new Promise((resolve) => {
    const res = { code: 200, status(c) { this.code = c; return this }, json(obj) { resolve({ code: this.code, body: obj }) } }
    delete process.env.APP_ACCESS_CODE
    jarvisHandler({ method: 'POST', headers: {}, body }, res)
  })

describe.skipIf(!process.env.JARVIS_TONE)('Jarvis tone sample (real model)', () => {
  it('writes his replies for reading and passes the mechanical checks', { timeout: 300_000 }, async () => {
    const reg = createAppRegistry(createLog(await openStore(`tone-${Math.random()}`), { channelName: `tone-${Math.random()}` }))
    const rows = []
    const failures = []
    for (const c of TONE_CASES) {
      const base = buildRequest({ history: [{ role: 'user', text: c.say }], registry: reg, events: [], now: NOW })
      const r = await call({ ...base, context: c.context })
      let text = ''
      let steps = []
      if (r.code === 200) ({ text, steps } = planFromContent(r.body.content, reg))
      const said = [text, ...steps.map((s) => `[would call ${s.name} ${JSON.stringify(s.args)}]`)].filter(Boolean).join('\n')
      const problems = toneProblems(text, c.maxChars ? { maxChars: c.maxChars } : {})
      for (const re of c.mustNot) if (re.test(text)) problems.push(`forbidden: ${re}`)
      if (problems.length) failures.push({ id: c.id, problems, text })
      rows.push({ c, said: said || '(no reply)', problems })
    }
    const md = [
      '# Jarvis tone sample',
      '',
      'Real replies to twenty-five situations, made with the current instructions. Read them against the rubric: ' + RUBRIC.join(', ') + '.',
      'Nothing here was edited. Lines marked "would call" are actions he chose instead of, or as well as, words.',
      '',
      ...rows.flatMap(({ c, said, problems }, i) => [
        `## ${i + 1}. ${c.id}`,
        '',
        `**You:** ${c.say}`,
        '',
        `**Jarvis:** ${said.replace(/\n/g, '  \n')}`,
        '',
        `*A good reply:* ${c.wants}`,
        problems.length ? `\n**Automatic check failed:** ${problems.join('; ')}\n` : '',
      ]),
    ].join('\n')
    writeFileSync('docs/v2/TONE-SAMPLE.md', md)
    expect(failures).toEqual([])
  })
})
