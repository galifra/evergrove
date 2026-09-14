// The fixed set of life domains — the main limbs of the tree.
// Skills (specific things you actually do) live under these and are
// discovered dynamically over time as you log entries.
export const DOMAINS = [
  { id: 'health', name: 'Health & Fitness', color: '#4ade80', glow: '#86efac', emoji: '\u{1F4AA}' },
  { id: 'mind', name: 'Mind & Learning', color: '#60a5fa', glow: '#93c5fd', emoji: '\u{1F9E0}' },
  { id: 'discipline', name: 'Discipline & Habits', color: '#fbbf24', glow: '#fde68a', emoji: '\u{1F525}' },
  { id: 'craft', name: 'Craft & Career', color: '#a78bfa', glow: '#c4b5fd', emoji: '\u{1F6E0}\u{FE0F}' },
  { id: 'social', name: 'Relationships & Social', color: '#fb7185', glow: '#fda4af', emoji: '\u{1F49E}' },
  { id: 'creativity', name: 'Creativity & Expression', color: '#fb923c', glow: '#fdba74', emoji: '\u{1F3A8}' },
  { id: 'inner', name: 'Inner Life & Purpose', color: '#818cf8', glow: '#a5b4fc', emoji: '\u{1F319}' },
]

export const DOMAIN_MAP = Object.fromEntries(DOMAINS.map((d) => [d.id, d]))

export function domainById(id) {
  return DOMAIN_MAP[id] ?? null
}
