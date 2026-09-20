import { AREAS, effectiveEvents, localDate } from '../core/events'
import { newContext, RULES, RULES_VERSION } from './rules'

// Folds the log into the tree. The output keeps the same shape the UI already
// used (skills by area, entries newest-first) so the tree renderer is unchanged.
export function deriveEvergrove(events) {
  const ctx = newContext()
  const skills = {}
  const entries = []
  const lastGrowthAt = {}
  const growthDays = new Set()

  for (const e of effectiveEvents(events)) {
    const rule = RULES[e.type]
    if (!rule) continue
    rule.observe?.(e, ctx)
    const grown = rule.grow ? rule.grow(e, ctx) : []
    if (!grown.length) continue

    for (const g of grown) {
      if (!AREAS.includes(g.domain)) continue
      const area = (skills[g.domain] ??= {})
      const existing = area[g.skillId]
      area[g.skillId] = existing
        ? { ...existing, xp: existing.xp + g.xp, updatedAt: e.occurredAt }
        : { id: g.skillId, name: g.skillName, xp: g.xp, createdAt: e.occurredAt, updatedAt: e.occurredAt }
      if (g.xp > 0) {
        if (!lastGrowthAt[g.domain] || e.occurredAt > lastGrowthAt[g.domain]) lastGrowthAt[g.domain] = e.occurredAt
        growthDays.add(localDate(e.occurredAt))
      }
    }

    entries.push({
      id: e.id,
      text: grown[0].text || e.data.text || e.type,
      createdAt: e.occurredAt,
      updates: grown.map((g) => ({ domain: g.domain, skillId: g.skillId, skillName: g.skillName, xpGain: g.xp })),
      summary: e.data.summary || '',
    })
  }

  entries.reverse()
  return {
    skills,
    entries,
    lastGrowthAt,
    growthDays,
    paused: [...ctx.paused],
    treeName: ctx.treeName,
    appRequests: [...ctx.appRequests.values()],
    trackers: [...ctx.trackers.values()],
    rulesVersion: RULES_VERSION,
  }
}
