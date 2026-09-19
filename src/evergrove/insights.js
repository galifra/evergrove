import { DOMAIN_MAP } from '../lib/domains'
import { AREAS, localDate } from '../core/events'

const DAY = 24 * 60 * 60 * 1000

// Insights are derived, disposable and never written back to the log, so they
// can never feed back into growth (no feedback loops).
export function deriveInsights(evState, now = new Date()) {
  const insights = []
  for (const area of AREAS) {
    if (evState.paused.includes(area)) continue
    const hasSkills = Object.keys(evState.skills[area] || {}).length > 0
    const last = evState.lastGrowthAt[area]
    if (!hasSkills || !last) continue
    const days = Math.floor((now - new Date(last)) / DAY)
    if (days >= 7) {
      insights.push({
        id: `quiet:${area}`,
        kind: 'quiet',
        area,
        days,
        message: `${DOMAIN_MAP[area].name} has been quiet for ${days} days.`,
      })
    }
  }

  const streak = growthStreak(evState.growthDays, now)
  if (streak >= 3) {
    insights.push({ id: 'streak', kind: 'streak', days: streak, message: `${streak} days in a row of growth.` })
  }
  return insights
}

export function growthStreak(growthDays, now = new Date()) {
  const cursor = new Date(now)
  if (!growthDays.has(localDate(cursor))) cursor.setDate(cursor.getDate() - 1)
  let streak = 0
  while (growthDays.has(localDate(cursor))) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}
