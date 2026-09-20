import { createEvent } from '@evergrove/core/events.js'
import { AREAS } from '@evergrove/core/events.js'
import { slugify } from '@evergrove/core/lib/treeEngine.js'

// Converts the pre-log localStorage tree (skills + entries) into events.
// Ids are deterministic, so running this twice (or on two devices) is harmless,
// and the derived tree matches the old one exactly.
export function legacyToEvents(legacy, now = new Date()) {
  const events = []
  const fromEntries = new Map() // "domain|skillId" -> xp already explained by entries

  for (const entry of legacy.entries ?? []) {
    ;(entry.updates ?? []).forEach((u, i) => {
      if (!AREAS.includes(u.domain)) return
      const xp = Math.max(1, Math.min(40, Math.round(Number(u.xpGain) || 0)))
      const skillId = slugify(u.skillId || u.skillName || 'skill')
      const key = `${u.domain}|${skillId}`
      fromEntries.set(key, (fromEntries.get(key) ?? 0) + xp)
      events.push(
        createEvent({
          id: `legacy:${entry.id}:${i}`,
          type: 'skill.practiced',
          app: 'evergrove',
          area: u.domain,
          actor: 'migration',
          occurredAt: entry.createdAt,
          now,
          data: {
            domain: u.domain,
            skillId,
            skillName: u.skillName || skillId,
            xp,
            text: entry.text,
            summary: entry.summary || '',
          },
        })
      )
    })
  }

  // Old saves capped the entry list, so a skill can hold more XP than its
  // surviving entries explain. Preserve the difference as one catch-up event.
  for (const [domain, skills] of Object.entries(legacy.skills ?? {})) {
    if (!AREAS.includes(domain)) continue
    for (const skill of Object.values(skills)) {
      const skillId = slugify(skill.id || skill.name)
      const explained = fromEntries.get(`${domain}|${skillId}`) ?? 0
      const missing = Math.round(Number(skill.xp) || 0) - explained
      if (missing <= 0) continue
      let remaining = missing
      let part = 0
      while (remaining > 0) {
        const chunk = Math.min(40, remaining)
        events.push(
          createEvent({
            id: `legacy:catchup:${domain}:${skillId}:${part}`,
            type: 'skill.practiced',
            app: 'evergrove',
            area: domain,
            actor: 'migration',
            occurredAt: skill.createdAt ?? now.toISOString(),
            now,
            data: { domain, skillId, skillName: skill.name || skillId, xp: chunk, text: 'Earlier progress' },
          })
        )
        remaining -= chunk
        part += 1
      }
    }
  }
  return events
}
