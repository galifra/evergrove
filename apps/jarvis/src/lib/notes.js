import { createEvent, effectiveEvents, localDate, newId } from '@evergrove/core/events.js'
import { buildContext, memoriesFor } from './jarvis.js'
import { memoryLines } from '@evergrove/modules/memory.js'
import { observe } from '@evergrove/rules/observations.js'
import { composeWeekly } from '@evergrove/rules/weekly.js'

// The plumbing around Jarvis's notes and feedback (docs/v2/FEEDBACK-SPEC.md): the two events
// that record what he said and what you thought of it, the goal coach's small plan, the
// requests for an opinion and a weekly polish, and the export that turns your feedback into
// test cases. None of this calls the AI by itself.

export const FEEDBACK_VALUES = ['up', 'down', 'not_useful', 'unmuted']

export const noteShownEvent = (candidate, now = new Date()) =>
  createEvent({ type: 'note.shown', app: 'jarvis', actor: 'jarvis', data: { obsId: candidate.obsId, key: candidate.key, date: localDate(now) } })

export function feedbackEvent({ targetKind, targetId, value, text, extra = {} }) {
  if (!['note', 'reply'].includes(targetKind)) throw new Error('Bad feedback target.')
  if (!FEEDBACK_VALUES.includes(value)) throw new Error('Bad feedback value.')
  const data = { targetKind, targetId: String(targetId).slice(0, 120), value, ...extra }
  if (text && String(text).trim()) data.text = String(text).trim().slice(0, 300)
  return createEvent({ type: 'feedback.given', app: 'jarvis', actor: 'user', data })
}

// Did this reply touch a private app? Then its words are never kept with the feedback, only the tool names.
export function touchesPrivate(steps = [], privateIds = new Set()) {
  return steps.some((s) => privateIds.has(String(s.name ?? '').split('__')[0]) || privateIds.has(String(s.args?.tracker ?? '').toLowerCase()))
}

// What is kept with a rating of a reply, so it can become a test case later.
export function replyFeedbackData(message, said, privateIds = new Set()) {
  const steps = message.steps ?? []
  const tools = steps.map((s) => s.name)
  const priv = touchesPrivate(steps, privateIds)
  return {
    tools,
    private: priv,
    ...(priv ? {} : { said: String(said ?? '').slice(0, 200), reply: String(message.text ?? '').slice(0, 300) }),
  }
}

// ---- the goal coach --------------------------------------------------------------

// A small plan for a stalled goal, made from what is already there: its unfinished milestones,
// or three generic first steps when it has none. Templates only; each becomes an ordinary
// add_task the person approves once.
export function coachSteps(goal, now = new Date()) {
  const today = localDate(now)
  const due = (days) => {
    const [y, m, d] = today.split('-').map(Number)
    return localDate(new Date(y, m - 1, d + days))
  }
  const open = (goal.milestones ?? []).filter((m) => !m.done).slice(0, 3)
  const titles = open.length
    ? open.map((m) => m.text)
    : [`Decide the very first step of "${goal.title}"`, `Spend 20 minutes on "${goal.title}"`, `Pick a date to check in on "${goal.title}"`]
  return titles.map((title, i) => ({ title: String(title).slice(0, 110), goal: goal.title, effort: 1, due: due(2 + i * 3) }))
}

// ---- asking for words, on request ----------------------------------------------------

// Everything the AI may see when asked for an opinion: the same context the chat gets (private
// apps only if shared), the week's review with private things left out, and the notes worth
// noticing that are not private.
const MONEY_OBS = new Set(['bill.overdue', 'bill.soon', 'deadline.soon', 'budget.over'])
export function opinionContext(registry, events, { shareSensitive = [], now = new Date() } = {}) {
  const parts = [buildContext(registry, events, { shareSensitive }, now)]
  const noticing = observe(events, now)
    .filter((o) => (o.private ? MONEY_OBS.has(o.obsId) && shareSensitive.includes('money') : true))
    .slice(0, 5)
    .map((o) => `- ${o.obsId}: ${JSON.stringify(o.params)}`)
  if (noticing.length) parts.push(`Things I have noticed:\n${noticing.join('\n')}`)
  parts.push(`This week so far, as a plain review:\n${composeWeekly(events, now).aiText}`)
  return parts.filter(Boolean).join('\n\n').slice(0, 3900)
}

const cleanTopic = (t) => String(t ?? '').replace(/[^\p{L}\p{N} .,'-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)

export function buildOpinionRequest({ topic, registry, events, shareSensitive = [], persona = null, now = new Date() }) {
  const t = cleanTopic(topic)
  const say = t ? `What do you honestly think about ${t}?` : 'What do you honestly think about how things are going?'
  const pad = (n) => String(n).padStart(2, '0')
  return {
    purpose: 'opinion',
    messages: [{ role: 'user', content: say }],
    context: opinionContext(registry, events, { shareSensitive, now }),
    today: localDate(now),
    nowLocal: `${localDate(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}`,
    weekday: now.toLocaleDateString('en-US', { weekday: 'long' }),
    persona,
    memory: memoryLines(memoriesFor(events, [{ role: 'user', text: t }], shareSensitive, now)) || undefined,
  }
}

export function buildWeeklyPolishRequest({ events, persona = null, now = new Date() }) {
  const review = composeWeekly(events, now)
  return { purpose: 'weekly', messages: [{ role: 'user', content: review.aiText.slice(0, 1900) }], persona, week: review.range.from }
}

// ---- export my feedback -----------------------------------------------------------------

/**
 * Your ratings, ready to become test cases. Ratings of replies become routing and tone cases
 * (the words you said, what he did, how you rated it); ratings of notes become a tally per kind.
 * A reply that touched a private app carries only its tool names.
 */
export function exportFeedback(events, now = new Date()) {
  const cases = []
  const notes = {}
  for (const e of effectiveEvents(events)) {
    if (e.type !== 'feedback.given') continue
    const d = e.data
    if (d.targetKind === 'note') {
      const row = (notes[d.targetId] ??= { up: 0, down: 0, notUseful: 0 })
      if (d.value === 'up') row.up += 1
      else if (d.value === 'down') row.down += 1
      else if (d.value === 'not_useful') row.notUseful += 1
    } else if (d.targetKind === 'reply' && (d.value === 'up' || d.value === 'down')) {
      cases.push({
        kind: d.value === 'down' ? 'to-fix' : 'to-keep',
        rated: d.value,
        said: d.said ?? null,
        tools: d.tools ?? [],
        reply: d.reply ?? null,
        whatWasOff: d.text ?? null,
        private: !!d.private,
        at: e.occurredAt,
      })
    }
  }
  const snippets = cases
    .filter((c) => c.said)
    .map((c) => {
      const said = JSON.stringify(c.said)
      const tools = c.tools.length ? c.tools.join(', ') : 'no tool'
      return c.rated === 'down'
        ? `// You rated this down${c.whatWasOff ? `: ${c.whatWasOff}` : ''}. He did: ${tools}. Decide what should happen and write the check.\n[${said}, (s) => /* what he should do */ false, 'new'],`
        : `// You rated this up. He did: ${tools}.\n[${said}, (s) => ${c.tools.length ? c.tools.map((t) => `s.some((x) => x.name === '${t}')`).join(' && ') : 's.length === 0'}, 'new'],`
    })
  return { format: 'jarvis-feedback', version: 1, exportedAt: now.toISOString(), id: newId(), notes, cases, evalSnippets: snippets }
}
