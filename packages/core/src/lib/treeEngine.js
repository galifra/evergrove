// XP / leveling math and derived "growth" stats for the tree.
// Kept deterministic and pure so the same state always renders the same tree.

// Cumulative XP cost curve — gentle at first, steeper later so leveling
// up stays meaningful for months, not days.
export function xpForLevel(level) {
  return Math.round(40 * Math.pow(level, 1.35) + 30)
}

export function levelFromXp(totalXp) {
  let level = 0
  let remaining = totalXp
  let cost = xpForLevel(level + 1)
  while (remaining >= cost) {
    remaining -= cost
    level += 1
    cost = xpForLevel(level + 1)
  }
  return { level, xpIntoLevel: remaining, xpForNext: cost, progress: cost > 0 ? remaining / cost : 0 }
}

export function skillTotalXp(skill) {
  return skill?.xp ?? 0
}

export function domainTotalXp(state, domainId) {
  const skills = state.skills[domainId] || {}
  return Object.values(skills).reduce((sum, s) => sum + skillTotalXp(s), 0)
}

export function domainSkillCount(state, domainId) {
  return Object.keys(state.skills[domainId] || {}).length
}

export function totalTreeXp(state) {
  return Object.keys(state.skills).reduce((sum, domainId) => sum + domainTotalXp(state, domainId), 0)
}

const STAGES = [
  { min: 0, name: 'Seed', blurb: 'Just planted. Log your first thing.' },
  { min: 60, name: 'Sprout', blurb: 'Something is stirring.' },
  { min: 250, name: 'Sapling', blurb: 'Roots are taking hold.' },
  { min: 700, name: 'Young Tree', blurb: 'Real branches now.' },
  { min: 1600, name: 'Flourishing Tree', blurb: 'Full and alive.' },
  { min: 3200, name: 'Ancient Grove', blurb: 'Years of consistency, visible.' },
]

export function treeStage(totalXp) {
  let current = STAGES[0]
  for (const s of STAGES) {
    if (totalXp >= s.min) current = s
  }
  return current
}

export function isToday(isoDate) {
  if (!isoDate) return false
  const d = new Date(isoDate)
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

export function todaysEntries(state) {
  return state.entries.filter((e) => isToday(e.createdAt))
}

export function currentStreak(state) {
  if (state.entries.length === 0) return 0
  const daysWithEntries = new Set(
    state.entries.map((e) => new Date(e.createdAt).toDateString())
  )
  let streak = 0
  const cursor = new Date()
  for (;;) {
    const key = cursor.toDateString()
    if (daysWithEntries.has(key)) {
      streak += 1
      cursor.setDate(cursor.getDate() - 1)
    } else if (streak === 0 && key === new Date().toDateString()) {
      // today not logged yet — check yesterday to keep streak alive
      cursor.setDate(cursor.getDate() - 1)
      continue
    } else {
      break
    }
  }
  return streak
}

export function slugify(str) {
  return String(str)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40) || 'skill'
}
