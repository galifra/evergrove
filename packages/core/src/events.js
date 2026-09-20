export const SCHEMA_VERSION = 1
export const AREAS = ['health', 'mind', 'discipline', 'craft', 'social', 'creativity', 'inner']

const TYPE_RE = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$/
const APP_RE = /^[a-z][a-z0-9_:-]*$/
const MAX_DATA_BYTES = 8192

export function newId() {
  return globalThis.crypto.randomUUID()
}

// Monotonic clock: two events written back to back never share a millisecond,
// so "created then completed" always replays in the order it happened.
let lastMs = 0
export function tick(now = new Date()) {
  const ms = Math.max(now.getTime(), lastMs + 1)
  lastMs = ms
  return new Date(ms)
}

// A short id for this browser, stamped on new events so the log can show which device wrote
// what. Older events have none. The runtime sets it at start; tests leave it unset.
let currentDevice = null
export function setDeviceId(id) {
  currentDevice = typeof id === 'string' && id ? id.slice(0, 16) : null
}

export function createEvent({
  id,
  type,
  app,
  area = null,
  data = {},
  occurredAt,
  actor = 'user',
  correlationId = null,
  supersedes = null,
  device,
  now,
}) {
  const nowIso = (now ?? tick()).toISOString()
  const dev = device ?? currentDevice
  return {
    id: id ?? newId(),
    v: SCHEMA_VERSION,
    type,
    app,
    area,
    occurredAt: occurredAt ?? nowIso,
    recordedAt: nowIso,
    actor,
    correlationId,
    supersedes,
    ...(dev ? { device: dev } : {}),
    data,
  }
}

export function validateEvent(e) {
  if (!e || typeof e !== 'object') return 'event must be an object'
  if (typeof e.id !== 'string' || !e.id || e.id.length > 200) return 'bad id'
  if (e.v !== SCHEMA_VERSION) return `unsupported schema version ${e.v}`
  if (typeof e.type !== 'string' || !TYPE_RE.test(e.type)) return 'bad type'
  if (typeof e.app !== 'string' || !APP_RE.test(e.app)) return 'bad app'
  if (e.area !== null && e.area !== undefined && !AREAS.includes(e.area)) return 'bad area'
  if (!isIso(e.occurredAt)) return 'bad occurredAt'
  if (!isIso(e.recordedAt)) return 'bad recordedAt'
  if (!['user', 'jarvis', 'migration', 'system', 'import'].includes(e.actor)) return 'bad actor'
  if (e.supersedes !== null && e.supersedes !== undefined && typeof e.supersedes !== 'string') {
    return 'bad supersedes'
  }
  if (e.device !== undefined && (typeof e.device !== 'string' || e.device.length > 24)) return 'bad device'
  if (!e.data || typeof e.data !== 'object' || Array.isArray(e.data)) return 'data must be an object'
  if (JSON.stringify(e.data).length > MAX_DATA_BYTES) return 'data too large'
  return null
}

function isIso(s) {
  return typeof s === 'string' && s.length >= 10 && !Number.isNaN(Date.parse(s))
}

export function compareEvents(a, b) {
  if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? -1 : 1
  if (a.recordedAt !== b.recordedAt) return a.recordedAt < b.recordedAt ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function sortEvents(events) {
  return [...events].sort(compareEvents)
}

// The set of events that still count: everything not cancelled by an
// effective superseding event. `event.reversed` is a pure cancel and is
// removed from the output. Reversing a reversal restores the original.
export function effectiveEvents(events) {
  const byId = new Map(events.map((e) => [e.id, e]))
  const supersededBy = new Map()
  for (const e of events) {
    if (!e.supersedes) continue
    if (!supersededBy.has(e.supersedes)) supersededBy.set(e.supersedes, [])
    supersededBy.get(e.supersedes).push(e.id)
  }

  const memo = new Map()
  const visiting = new Set()
  function isEffective(id) {
    if (memo.has(id)) return memo.get(id)
    if (visiting.has(id)) return true
    visiting.add(id)
    const killers = supersededBy.get(id) || []
    const result = !killers.some((k) => byId.has(k) && isEffective(k))
    visiting.delete(id)
    memo.set(id, result)
    return result
  }

  return sortEvents(events).filter((e) => e.type !== 'event.reversed' && isEffective(e.id))
}

// Local calendar date (YYYY-MM-DD) for an instant, on this device.
export function localDate(input = new Date()) {
  const d = input instanceof Date ? input : new Date(input)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
