import { validateEvent, effectiveEvents } from './events'
import { deriveEvergrove } from '../evergrove/derive'

// "Check my data": is every stored event well-formed, and does everything derived
// from the log rebuild to exactly the same result no matter what order the events
// arrive in? Nothing is changed; this only reports.

function fingerprint(events) {
  const s = deriveEvergrove(events)
  return JSON.stringify({ skills: s.skills, treeName: s.treeName, paused: [...s.paused].sort(), trackers: s.trackers.map((t) => t.id).sort() })
}

export function verifyLog(events) {
  const invalid = []
  const seen = new Set()
  let duplicates = 0
  for (const e of events) {
    const problem = validateEvent(e)
    if (problem) invalid.push({ id: e?.id ?? '?', type: e?.type ?? '?', problem })
    if (seen.has(e?.id)) duplicates += 1
    seen.add(e?.id)
  }

  const ids = new Set(events.map((e) => e.id))
  const pendingCorrections = events.filter((e) => e.supersedes && !ids.has(e.supersedes)).length
  const corrections = events.filter((e) => e.supersedes).length
  const effective = effectiveEvents(events).length

  const valid = events.filter((e) => !validateEvent(e))
  const live = fingerprint(valid)
  const reversed = fingerprint([...valid].reverse())
  const shuffled = fingerprint([...valid].sort((a, b) => (a.id < b.id ? 1 : -1)))

  const times = valid.map((e) => e.occurredAt).sort()
  return {
    total: events.length,
    invalid,
    duplicates,
    corrections,
    pendingCorrections,
    effective,
    rebuildsIdentically: live === reversed && live === shuffled,
    from: times[0]?.slice(0, 10) ?? null,
    to: times.at(-1)?.slice(0, 10) ?? null,
  }
}

export function describeVerification(r) {
  const lines = [`${r.total.toLocaleString()} events${r.from ? `, ${r.from} to ${r.to}` : ''}.`]
  lines.push(r.invalid.length ? `${r.invalid.length} invalid (first: ${r.invalid[0].type}, ${r.invalid[0].problem}).` : 'All events are valid.')
  if (r.duplicates) lines.push(`${r.duplicates} duplicate id${r.duplicates === 1 ? '' : 's'}.`)
  lines.push(`${r.corrections} correction${r.corrections === 1 ? '' : 's'} recorded${r.pendingCorrections ? `, ${r.pendingCorrections} waiting for the event they correct (normal while syncing)` : ''}.`)
  lines.push(r.rebuildsIdentically ? 'The tree rebuilds identically from the log.' : 'WARNING: the tree did not rebuild identically. Export a backup and tell me.')
  return lines.join(' ')
}
