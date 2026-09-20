import { createEvent, tick } from './events'
import { validateArgs } from './schema'

// The command channel. Jarvis (or any caller) invokes `module__action`; the
// registry validates, enforces the permission tier in code, runs the action
// with a timeout, appends the resulting events and writes an audit event.
//
// Tiers: auto = runs now, ask = needs `approved: true`, suggest = never runs.

export function createRegistry({ log, timeoutMs = 5000 }) {
  const modules = new Map()

  function register(manifest) {
    modules.set(manifest.id, manifest)
  }

  function toolName(moduleId, action) {
    return `${moduleId}__${action}`
  }

  function tools() {
    const out = []
    for (const m of modules.values()) {
      for (const a of m.actions ?? []) {
        out.push({
          name: toolName(m.id, a.name),
          moduleId: m.id,
          action: a.name,
          description: a.description,
          tier: a.tier,
          input: a.input ?? { type: 'object', properties: {} },
        })
      }
    }
    return out
  }

  function resolve(name) {
    const [moduleId, actionName] = String(name).split('__')
    const m = modules.get(moduleId)
    const a = m?.actions?.find((x) => x.name === actionName)
    return m && a ? { module: m, action: a } : null
  }

  function stateOf(moduleId, now = new Date()) {
    const m = modules.get(moduleId)
    return m?.derive ? m.derive(log.getEvents(), now) : null
  }

  async function invoke(name, rawArgs, { approved = false, correlationId = null, actor = 'jarvis', now = new Date() } = {}) {
    const found = resolve(name)
    if (!found) return { status: 'error', error: `Unknown action ${name}` }
    const { module: m, action } = found

    const checked = validateArgs(action.input ?? { type: 'object', properties: {} }, rawArgs ?? {}, 'args')
    if (checked.error) return { status: 'error', error: checked.error }
    const args = checked.value ?? {}

    if (action.tier === 'suggest') {
      return { status: 'suggest-only', summary: `I can suggest this but not do it: ${action.description}` }
    }
    if (action.tier === 'ask' && !approved) {
      return { status: 'needs-approval', args }
    }

    let result
    try {
      result = await Promise.race([
        Promise.resolve(action.run(args, { state: (id) => stateOf(id, now), moduleState: () => stateOf(m.id, now), now, events: log.getEvents() })),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), timeoutMs)),
      ])
    } catch (err) {
      return { status: 'error', error: `${m.name}: ${err.message}` }
    }

    if (result?.error) return { status: 'error', error: result.error }

    const events = (result?.events ?? []).map((e) =>
      createEvent({
        id: e.id,
        type: e.type,
        app: e.app ?? m.id,
        area: e.area ?? m.area ?? null,
        occurredAt: e.occurredAt,
        data: e.data ?? {},
        supersedes: e.supersedes ?? null,
        actor,
        correlationId,
        now: tick(now),
      })
    )
    const added = events.length ? await log.append(events) : []

    let commandId = null
    if (added.length) {
      const audit = createEvent({
        type: 'command.executed',
        app: 'jarvis',
        area: null,
        actor,
        correlationId,
        now: tick(now),
        data: {
          tool: name,
          module: m.id,
          summary: String(result?.summary ?? '').slice(0, 300),
          eventIds: added.map((e) => e.id),
        },
      })
      await log.append(audit)
      commandId = audit.id
    }
    return { status: 'done', summary: result?.summary ?? 'Done.', eventIds: added.map((e) => e.id), commandId }
  }

  // Undo appends cancelling events; nothing is deleted, and undoing the undo
  // (cancelling those cancels) restores everything.
  async function undo(commandId, { now = new Date() } = {}) {
    const audit = log.getEvents().find((e) => e.id === commandId && e.type === 'command.executed')
    if (!audit) return { status: 'error', error: 'That action can no longer be undone.' }
    const targets = [...audit.data.eventIds, audit.id]
    const reversals = targets.map((id) =>
      createEvent({
        type: 'event.reversed',
        app: 'jarvis',
        area: null,
        supersedes: id,
        actor: 'user',
        correlationId: audit.correlationId,
        now: tick(now),
        data: { reason: 'undo' },
      })
    )
    await log.append(reversals)
    return { status: 'done', summary: `Undid: ${audit.data.summary}` }
  }

  return { register, tools, resolve, invoke, undo, stateOf, modules: () => [...modules.values()] }
}
