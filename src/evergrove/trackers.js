import { AREAS } from '../core/events'
import { slugify } from '../lib/treeEngine'

// A tracker is an app defined entirely by data: fields to log, which life area
// it feeds, and how an entry turns into growth. Built-ins live here; custom
// ones arrive as `tracker.defined` events (so Jarvis can create them by talking).

export const FIELD_TYPES = ['text', 'number', 'select']

const f = {
  text: (key, label, extra = {}) => ({ key, label, type: 'text', ...extra }),
  num: (key, label, extra = {}) => ({ key, label, type: 'number', ...extra }),
  sel: (key, label, options, extra = {}) => ({ key, label, type: 'select', options, ...extra }),
}

export const BUILTIN_TRACKERS = [
  {
    id: 'body',
    name: 'Body',
    icon: 'dumbbell',
    area: 'health',
    description: 'Workouts, movement and training.',
    fields: [
      f.text('kind', 'Activity', { required: true, placeholder: 'Running, lifting, yoga' }),
      f.num('minutes', 'Minutes', { required: true, min: 1, max: 600 }),
      f.sel('intensity', 'Intensity', ['easy', 'medium', 'hard']),
      f.text('notes', 'Notes'),
    ],
    growth: { skill: { field: 'kind' }, xp: { field: 'minutes', per: 3, min: 3, max: 30 } },
    stat: { field: 'minutes', label: 'min' },
  },
  {
    id: 'health',
    name: 'Health & diet',
    icon: 'heart-pulse',
    area: 'health',
    description: 'Meals, sleep, weight, water and check-ups.',
    fields: [
      f.sel('kind', 'Type', ['meal', 'sleep', 'weight', 'water', 'symptom', 'checkup'], { required: true }),
      f.text('what', 'What', { placeholder: 'Oatmeal, 7.5h, 172 lb' }),
      f.num('value', 'Number (calories, hours, lbs, cups)'),
      f.text('notes', 'Notes'),
    ],
    growth: { skill: { field: 'kind' }, xp: { flat: 3 } },
    sensitive: true,
  },
  {
    id: 'mind',
    name: 'Mind',
    icon: 'brain',
    area: 'mind',
    description: 'Journaling, meditation, gratitude, therapy.',
    fields: [
      f.sel('kind', 'Type', ['journal', 'meditation', 'gratitude', 'therapy', 'reading'], { required: true }),
      f.num('minutes', 'Minutes', { min: 1, max: 600 }),
      f.num('mood', 'Mood 1-5', { min: 1, max: 5 }),
      f.text('notes', 'Notes'),
    ],
    growth: { skill: { field: 'kind' }, xp: { field: 'minutes', per: 3, min: 4, max: 20 } },
    sensitive: true,
  },
  {
    id: 'selfcare',
    name: 'Self-care',
    icon: 'sparkles',
    area: 'inner',
    description: 'Rest, recovery and things that refill you.',
    fields: [
      f.text('activity', 'What did you do?', { required: true }),
      f.num('minutes', 'Minutes', { min: 1, max: 600 }),
      f.text('notes', 'Notes'),
    ],
    growth: { skill: { fixed: 'Self-care' }, xp: { flat: 4 } },
  },
  {
    id: 'learning',
    name: 'Learning',
    icon: 'graduation-cap',
    area: 'mind',
    description: 'Study sessions, courses and books.',
    fields: [
      f.text('subject', 'Subject', { required: true, placeholder: 'Spanish, calculus, guitar theory' }),
      f.num('minutes', 'Minutes', { required: true, min: 1, max: 600 }),
      f.text('material', 'Material'),
      f.text('notes', 'Notes'),
    ],
    growth: { skill: { field: 'subject' }, xp: { field: 'minutes', per: 3, min: 3, max: 30 } },
    stat: { field: 'minutes', label: 'min' },
  },
  {
    id: 'creativity',
    name: 'Creativity',
    icon: 'palette',
    area: 'creativity',
    description: 'Projects, practice and ideas.',
    fields: [
      f.text('project', 'Project or craft', { required: true }),
      f.num('minutes', 'Minutes', { min: 1, max: 600 }),
      f.text('notes', 'Notes or idea'),
    ],
    growth: { skill: { field: 'project' }, xp: { field: 'minutes', per: 3, min: 3, max: 30 } },
    stat: { field: 'minutes', label: 'min' },
  },
  {
    id: 'career',
    name: 'Career',
    icon: 'briefcase',
    area: 'craft',
    description: 'Skills, applications, networking and wins.',
    fields: [
      f.sel('kind', 'Type', ['skill work', 'application', 'networking', 'interview', 'win'], { required: true }),
      f.text('title', 'What', { required: true }),
      f.text('notes', 'Notes'),
    ],
    growth: { skill: { field: 'kind' }, xp: { flat: 6 } },
  },
  {
    id: 'hustles',
    name: 'Side hustles',
    icon: 'rocket',
    area: 'craft',
    description: 'Ideas, experiments and income opportunities.',
    fields: [
      f.text('idea', 'Idea or gig', { required: true }),
      f.sel('status', 'Status', ['idea', 'researching', 'started', 'earning'], { required: true }),
      f.num('incomeCents', 'Income (cents)', { min: 0 }),
      f.text('notes', 'Notes'),
    ],
    growth: { skill: { fixed: 'Side hustle' }, xp: { flat: 5 } },
  },
  {
    id: 'travel',
    name: 'Travel',
    icon: 'plane',
    area: 'creativity',
    description: 'Trips, plans, bookings and memories.',
    fields: [
      f.text('trip', 'Trip', { required: true }),
      f.sel('kind', 'Type', ['plan', 'booking', 'packing', 'memory'], { required: true }),
      f.text('notes', 'Notes'),
    ],
    growth: { skill: { fixed: 'Exploring' }, xp: { flat: 3 } },
  },
  {
    id: 'home',
    name: 'Home',
    icon: 'home',
    area: 'discipline',
    description: 'Chores, maintenance, pets, caregiving and household paperwork.',
    fields: [
      f.text('what', 'What', { required: true }),
      f.sel('kind', 'Type', ['chore', 'maintenance', 'pet', 'caregiving', 'paperwork'], { required: true }),
      f.text('notes', 'Notes'),
    ],
    growth: { skill: { field: 'kind' }, xp: { flat: 3 } },
  },
  {
    id: 'records',
    name: 'Records',
    icon: 'archive',
    area: 'discipline',
    description: 'A log of things done: bills, errands, filings, warranties.',
    fields: [
      f.text('what', 'What got done', { required: true }),
      f.sel('category', 'Category', ['bill', 'errand', 'filing', 'warranty', 'insurance', 'tax', 'other'], { required: true }),
      f.num('amountCents', 'Amount (cents)', { min: 0 }),
      f.text('notes', 'Notes'),
    ],
    growth: { skill: { fixed: 'Getting it done' }, xp: { flat: 2 } },
  },
  {
    id: 'compass',
    name: 'Compass',
    icon: 'compass',
    area: 'inner',
    description: 'Values, long-term goals, decisions and reviews.',
    fields: [
      f.sel('kind', 'Type', ['value', 'long-term goal', 'decision', 'review'], { required: true }),
      f.text('title', 'Title', { required: true }),
      f.text('notes', 'Notes'),
    ],
    growth: { skill: { fixed: 'Reflection' }, xp: { flat: 5 } },
    sensitive: true,
  },
]

export function normalizeTrackerDef(input) {
  if (!input || typeof input !== 'object') return null
  const name = String(input.name ?? '').trim().slice(0, 40)
  const id = slugify(input.id ?? input.trackerId ?? name)
  if (!name || !id) return null
  if (!AREAS.includes(input.area)) return null
  const fields = Array.isArray(input.fields) ? input.fields.slice(0, 8) : []
  const cleanFields = []
  for (const raw of fields) {
    const key = slugify(raw?.key ?? raw?.label ?? '').replace(/-/g, '_')
    const type = FIELD_TYPES.includes(raw?.type) ? raw.type : 'text'
    if (!key) continue
    const field = { key, label: String(raw.label ?? key).slice(0, 40), type }
    if (raw.required) field.required = true
    if (type === 'select') {
      field.options = Array.isArray(raw.options) ? raw.options.map((o) => String(o).slice(0, 30)).slice(0, 12) : []
      if (!field.options.length) field.type = 'text'
    }
    if (type === 'number') {
      if (Number.isFinite(raw.min)) field.min = raw.min
      if (Number.isFinite(raw.max)) field.max = raw.max
    }
    cleanFields.push(field)
  }
  if (!cleanFields.length) cleanFields.push({ key: 'notes', label: 'Notes', type: 'text', required: true })

  const g = input.growth ?? {}
  const growth = {
    skill: g.skill?.field && cleanFields.some((x) => x.key === g.skill.field)
      ? { field: g.skill.field }
      : { fixed: String(g.skill?.fixed ?? name).slice(0, 40) },
    xp:
      g.xp?.field && cleanFields.some((x) => x.key === g.xp.field && x.type === 'number')
        ? {
            field: g.xp.field,
            per: Math.max(1, Number(g.xp.per) || 1),
            min: clampInt(g.xp.min, 1, 40, 1),
            max: clampInt(g.xp.max, 1, 40, 20),
          }
        : { flat: clampInt(g.xp?.flat, 1, 40, 3) },
  }

  return {
    id,
    name,
    icon: String(input.icon ?? 'sparkles').slice(0, 24),
    area: input.area,
    description: String(input.description ?? '').slice(0, 140),
    fields: cleanFields,
    growth,
    stat: input.stat?.field ? { field: String(input.stat.field), label: String(input.stat.label ?? '').slice(0, 12) } : undefined,
    sensitive: !!input.sensitive,
  }
}

function clampInt(v, min, max, fallback) {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

// Validates a set of values against a tracker's fields. Returns
// { values, error } where values only contains known, coerced fields.
export function validateEntry(def, raw = {}) {
  const values = {}
  for (const field of def.fields) {
    let v = raw[field.key]
    const empty = v === undefined || v === null || String(v).trim() === ''
    if (empty) {
      if (field.required) return { error: `${field.label} is required` }
      continue
    }
    if (field.type === 'number') {
      v = Number(v)
      if (!Number.isFinite(v)) return { error: `${field.label} must be a number` }
      if (field.min !== undefined && v < field.min) return { error: `${field.label} must be at least ${field.min}` }
      if (field.max !== undefined && v > field.max) return { error: `${field.label} must be at most ${field.max}` }
    } else if (field.type === 'select') {
      v = String(v)
      if (!field.options.includes(v)) return { error: `${field.label} must be one of: ${field.options.join(', ')}` }
    } else {
      v = String(v).trim().slice(0, 200)
    }
    values[field.key] = v
  }
  return { values }
}

export function trackerGrowth(def, values = {}) {
  const skillName =
    (def.growth.skill.field ? String(values[def.growth.skill.field] ?? '').trim() : def.growth.skill.fixed) || def.name
  const name = skillName.slice(0, 60)
  const x = def.growth.xp
  let xp
  if (x.flat !== undefined) xp = x.flat
  else {
    const n = Number(values[x.field])
    xp = Number.isFinite(n) ? Math.min(x.max, Math.max(x.min, Math.round(n / x.per))) : x.min
  }
  return { domain: def.area, skillId: slugify(name), skillName: name, xp }
}

// Totals per calendar week (Monday start), oldest first, for the bar chart on a
// tracker's page: the sum of its headline number if it has one, else the count.
export function weeklyTotals(entries, def, weeks = 8, now = new Date()) {
  const monday = (d) => {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
    return x
  }
  const thisWeek = monday(now)
  const buckets = []
  for (let i = weeks - 1; i >= 0; i--) {
    const start = new Date(thisWeek)
    start.setDate(start.getDate() - i * 7)
    buckets.push({ start, value: 0 })
  }
  for (const e of entries) {
    const at = monday(new Date(e.occurredAt))
    const b = buckets.find((x) => x.start.getTime() === at.getTime())
    if (!b) continue
    b.value += def.stat ? Number(e.data.values?.[def.stat.field]) || 0 : 1
  }
  const pad = (n) => String(n).padStart(2, '0')
  return buckets.map((b) => ({
    start: `${b.start.getFullYear()}-${pad(b.start.getMonth() + 1)}-${pad(b.start.getDate())}`,
    value: b.value,
  }))
}
