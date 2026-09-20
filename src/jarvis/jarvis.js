import { localDate } from '../core/events'
import { deriveEvergrove } from '../evergrove/derive'
import { getAccessCode } from '../lib/storage'

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
    const text = m.context(m.derive(events, now), now)
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

export function buildRequest({ history, registry, events, shareSensitive = [], now = new Date() }) {
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
