import { localDate } from '@evergrove/core/events.js'
import { deriveEvergrove } from '@evergrove/rules/derive.js'
import { getAccessCode } from '@evergrove/core/lib/storage.js'
import { validateArgs } from '@evergrove/core/schema.js'
import { deriveMemory, memoryLines, selectMemories } from '@evergrove/modules/memory.js'

const MAX_HISTORY = 10

export function trackerCatalog(trackers) {
  return trackers
    .map((t) => {
      const fields = t.fields
        .map((f) => `${f.key}${f.required ? '*' : ''}${f.type === 'select' ? `(${f.options.join('|')})` : f.type === 'number' ? '#' : ''}`)
        .join(', ')
      return `${t.id}: ${t.name} - ${fields}`
    })
    .join('\n')
}

// Context is assembled locally. Modules marked sensitive are left out unless
// the user explicitly shared them; that is enforced here, in code, before any
// network request exists.
// Which apps contributed to what the model is told, and which private ones
// were held back. Sensitive apps are excluded here, in code, unless shared.
export function contextSources(registry, events, { shareSensitive = [] } = {}, now = new Date()) {
  const used = []
  const withheld = []
  for (const m of registry.modules()) {
    if (!m.context || !m.derive) continue
    if (m.sensitive && !shareSensitive.includes(m.id)) {
      withheld.push({ id: m.id, name: m.name })
      continue
    }
    const text = m.context(m.derive(events, now), now, { shared: shareSensitive })
    if (text) used.push({ id: m.id, name: m.name, sensitive: !!m.sensitive, text })
  }
  return { used, withheld }
}

export function buildContext(registry, events, options = {}, now = new Date()) {
  return contextSources(registry, events, options, now)
    .used.map((u) => `[${u.name}]\n${u.text}`)
    .join('\n')
    .slice(0, 3500)
}

// A lookup the model copies from, so weekday words never depend on it doing
// date arithmetic (which it gets wrong).
export function upcomingDays(now = new Date(), ahead = 21, back = 7) {
  const out = []
  for (let i = -back; i < ahead; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i)
    const label = d.toLocaleDateString('en-US', { weekday: 'long' })
    const off = `${i > 0 ? '+' : ''}${i}`
    const note = i === 0 ? ' (today)' : i === 1 ? ' (tomorrow, +1)' : i === -1 ? ' (yesterday, -1)' : ` (${off} days)`
    out.push(`${label} ${localDate(d)}${note}`)
  }
  return out.join('\n')
}

// Ready-made answers for the relative phrases people use most, worked out
// here in code so the model copies a date instead of adding numbers.
export function relativePhrases(now = new Date()) {
  const at = (n) => localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n))
  const lastOfMonth = localDate(new Date(now.getFullYear(), now.getMonth() + 1, 0))
  const firstOfNext = localDate(new Date(now.getFullYear(), now.getMonth() + 1, 1))
  return [
    `the day after tomorrow = ${at(2)} (+2)`,
    `in three days = ${at(3)} (+3)`,
    `in a week / a week from today / same day next week = ${at(7)} (+7)`,
    `a week from tomorrow = ${at(8)} (+8)`,
    `in two weeks = ${at(14)} (+14)`,
    `in three weeks = ${at(21)} (+21)`,
    `end of the month = ${lastOfMonth}`,
    `the first of next month = ${firstOfNext}`,
  ].join('\n')
}

// The notes he is told for this message (a local rule, no AI). Private notes only if shared.
export function memoriesFor(events, history, shareSensitive = [], now = new Date()) {
  const lastUser = [...(history ?? [])].reverse().find((m) => m.role === 'user')
  return selectMemories(deriveMemory(events, now).notes, lastUser?.text ?? lastUser?.content ?? '', { shared: shareSensitive, now })
}

export function buildRequest({ history, registry, events, shareSensitive = [], persona = null, now = new Date() }) {
  const evState = deriveEvergrove(events)
  const tools = registry.tools().map((t) => ({ name: t.name, description: t.description, input_schema: t.input }))
  const pad = (n) => String(n).padStart(2, '0')
  const recent = history.slice(-MAX_HISTORY)
  while (recent.length && recent[0].role !== 'user') recent.shift()
  return {
    messages: recent.map((m) => ({ role: m.role, content: m.text || '(no reply)' })),
    tools,
    catalog: trackerCatalog(evState.trackers),
    context: buildContext(registry, events, { shareSensitive }, now),
    today: localDate(now),
    days: upcomingDays(now),
    phrases: relativePhrases(now),
    persona: { ...(persona ?? {}), name: persona?.name || deriveMemory(events, now).name || undefined },
    memory: memoryLines(memoriesFor(events, history, shareSensitive, now)) || undefined,
    nowLocal: `${localDate(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}`,
    weekday: now.toLocaleDateString('en-US', { weekday: 'long' }),
  }
}

// Turns model output into steps, dropping anything that is not a real tool.
export function planFromContent(content, registry) {
  const text = content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim()
  const steps = []
  for (const block of content) {
    if (block.type !== 'tool_use') continue
    const found = registry.resolve(block.name)
    if (!found) continue
    steps.push({
      id: block.id,
      name: block.name,
      args: block.input ?? {},
      tier: found.action.tier,
      moduleName: found.module.name,
      description: found.action.description,
      status: 'pending',
    })
  }
  return { text, steps }
}

// Decides whether the cheap model's answer is unusable and worth one retry on a
// stronger model: a tool it invented, arguments that break the tool's schema,
// or no answer at all. A clarifying question is NOT a failure: it is the right
// answer to an unclear request, and a bigger model would not know more.
export function needsEscalation(reply, registry) {
  const content = reply?.content ?? []
  if (reply?.dropped > 0) return 'unknown-tool'
  const hasText = content.some((b) => b.type === 'text' && b.text.trim())
  const calls = content.filter((b) => b.type === 'tool_use')
  if (!hasText && !calls.length) return 'empty'
  for (const block of calls) {
    const found = registry.resolve(block.name)
    if (!found) return 'unknown-tool'
    if (validateArgs(found.action.input ?? { type: 'object', properties: {} }, block.input ?? {}, 'args').error) return 'invalid-arguments'
  }
  return null
}

export async function askJarvis(payload, fetchImpl = fetch) {
  const res = await fetchImpl('/api/jarvis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-app-code': getAccessCode() },
    body: JSON.stringify(payload),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(body.error || `Jarvis request failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return body
}

// Runs the steps that are allowed to run right now. `ask` steps wait for the
// user; the registry double-checks that in code anyway.
export async function runAutoSteps(steps, registry, correlationId) {
  for (const step of steps) {
    if (step.tier !== 'auto') {
      step.status = step.tier === 'suggest' ? 'suggest-only' : 'needs-approval'
      continue
    }
    Object.assign(step, await execute(step, registry, correlationId, false))
  }
  return steps
}

export async function approveStep(step, registry, correlationId) {
  Object.assign(step, await execute(step, registry, correlationId, true))
  return step
}

async function execute(step, registry, correlationId, approved) {
  const r = await registry.invoke(step.name, step.args, { approved, correlationId })
  if (r.status === 'done') return { status: 'done', result: r.summary, commandId: r.commandId }
  if (r.status === 'error') return { status: 'error', result: r.error }
  if (r.status === 'needs-approval') return { status: 'needs-approval' }
  return { status: 'suggest-only', result: r.summary }
}
