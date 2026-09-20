import { AREAS } from '../core/events'
import { findOne } from '../core/match'
import { slugify } from '../lib/treeEngine'
import { deriveEvergrove } from '../evergrove/derive'
import { deriveInsights, growthStreak } from '../evergrove/insights'
import { normalizeTrackerDef, validateEntry } from '../evergrove/trackers'
import { DOMAIN_MAP } from '../lib/domains'

// Evergrove's own actions: grow skills directly, log to any tracker, define
// new trackers (new "apps") by description, and pause/resume areas.

const AREA = { type: 'string', enum: AREAS }

export const evergroveModule = {
  id: 'evergrove',
  name: 'Evergrove',
  icon: 'trees',
  area: null,
  description: 'The tree: every area of your life, grown from everything you do.',
  derive: (events) => deriveEvergrove(events),
  context(state, now = new Date()) {
    const lines = []
    for (const area of AREAS) {
      const skills = Object.values(state.skills[area] ?? {})
      if (skills.length) {
        const top = skills.sort((a, b) => b.xp - a.xp).slice(0, 4).map((s) => `${s.name} ${s.xp}xp`)
        lines.push(`${DOMAIN_MAP[area].name}${state.paused.includes(area) ? ' (paused)' : ''}: ${top.join(', ')}`)
      }
    }
    const weekAgo = now.getTime() - 7 * 86400000
    const week = state.entries.filter((e) => new Date(e.createdAt).getTime() >= weekAgo)
    if (week.length) {
      const byArea = {}
      for (const e of week) for (const u of e.updates) byArea[u.domain] = (byArea[u.domain] ?? 0) + u.xpGain
      const parts = Object.entries(byArea).filter(([, xp]) => xp > 0).map(([a, xp]) => `${DOMAIN_MAP[a].name} ${xp}xp`)
      const total = Object.values(byArea).reduce((s, x) => s + x, 0)
      lines.push(`Last 7 days: ${week.length} entries, ${total} xp (${parts.join(', ') || 'none'}). Growth streak: ${growthStreak(state.growthDays, now)} days.`)
    } else if (Object.keys(state.skills).length) {
      lines.push('Last 7 days: no growth logged.')
    }
    const insights = deriveInsights(state, now).map((i) => i.message)
    if (insights.length) lines.push('Insights: ' + insights.join(' '))
    return lines.join('\n')
  },
  actions: [
    {
      name: 'practice_skill',
      tier: 'auto',
      description:
        'Record that the user practiced or did a skill or activity that has no dedicated tracker. Small: 3-8 xp. Solid session: 10-20. Major effort: 25-40.',
      input: {
        type: 'object',
        properties: {
          area: AREA,
          skill: { type: 'string', maxLength: 60 },
          xp: { type: 'integer', minimum: 1, maximum: 40 },
          note: { type: 'string', maxLength: 120 },
        },
        required: ['area', 'skill', 'xp'],
      },
      run(args) {
        return {
          summary: `+${args.xp} xp to ${args.skill} (${DOMAIN_MAP[args.area].name}).`,
          events: [
            {
              type: 'skill.practiced',
              area: args.area,
              data: { domain: args.area, skillId: slugify(args.skill), skillName: args.skill, xp: args.xp, text: args.note || args.skill },
            },
          ],
        }
      },
    },
    {
      name: 'add_skill',
      tier: 'auto',
      description: 'Plant a new skill on the tree without logging progress yet.',
      input: {
        type: 'object',
        properties: { area: AREA, skill: { type: 'string', maxLength: 60 } },
        required: ['area', 'skill'],
      },
      run(args) {
        return {
          summary: `Planted "${args.skill}" in ${DOMAIN_MAP[args.area].name}.`,
          events: [{ type: 'skill.added', area: args.area, data: { domain: args.area, skillName: args.skill } }],
        }
      },
    },
    {
      name: 'log_tracker_entry',
      tier: 'auto',
      description: 'Log an entry in one of the trackers (apps) listed in the catalog. values maps field keys to values.',
      input: {
        type: 'object',
        properties: { tracker: { type: 'string', maxLength: 60 }, values: { type: 'object' } },
        required: ['tracker', 'values'],
      },
      run(args, { moduleState }) {
        const state = moduleState()
        const r = findOne(state.trackers, args.tracker, { label: (t) => t.name, noun: 'tracker' })
        if (r.error) return { error: r.error }
        const v = validateEntry(r.item, args.values)
        if (v.error) return { error: `${r.item.name}: ${v.error}` }
        return {
          summary: `Logged in ${r.item.name}.`,
          events: [{ type: 'tracker.entry', app: r.item.id, area: r.item.area, data: { trackerId: r.item.id, values: v.values } }],
        }
      },
    },
    {
      name: 'create_tracker',
      tier: 'ask',
      description:
        'Create a brand-new tracker (mini app) for something the user wants to log, with its own fields. Pick the life area it grows.',
      input: {
        type: 'object',
        properties: {
          name: { type: 'string', maxLength: 40 },
          area: AREA,
          description: { type: 'string', maxLength: 140 },
          fields: {
            type: 'array',
            maxItems: 8,
            items: {
              type: 'object',
              properties: {
                key: { type: 'string', maxLength: 30 },
                label: { type: 'string', maxLength: 40 },
                type: { type: 'string', enum: ['text', 'number', 'select'] },
                options: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 30 } },
                required: { type: 'boolean' },
              },
              required: ['label'],
            },
          },
          skillName: { type: 'string', maxLength: 40, description: 'Skill on the tree that entries grow' },
          xpPerEntry: { type: 'integer', minimum: 1, maximum: 40 },
        },
        required: ['name', 'area', 'fields'],
      },
      run(args, { moduleState }) {
        const state = moduleState()
        const def = normalizeTrackerDef({
          name: args.name,
          area: args.area,
          description: args.description,
          fields: args.fields,
          growth: { skill: { fixed: args.skillName ?? args.name }, xp: { flat: args.xpPerEntry ?? 4 } },
        })
        if (!def) return { error: 'That tracker definition is not valid.' }
        if (state.trackers.some((t) => t.id === def.id)) return { error: `A tracker called "${def.name}" already exists.` }
        return {
          summary: `Created the "${def.name}" tracker (${def.fields.map((f) => f.label).join(', ')}). It's now in Apps.`,
          events: [{ type: 'tracker.defined', area: def.area, data: { ...def, trackerId: def.id } }],
        }
      },
    },
    {
      name: 'request_app',
      tier: 'auto',
      description:
        'Save a spec for a whole new app the user wants that a simple tracker cannot do (its own screens, calculations, charts or integrations). It goes on the Apps page as a ready-to-build request.',
      input: {
        type: 'object',
        properties: {
          name: { type: 'string', maxLength: 40 },
          purpose: { type: 'string', maxLength: 300, description: 'What the app is for, in one or two sentences' },
          tracks: { type: 'string', maxLength: 300, description: 'The information it should keep' },
          screens: { type: 'string', maxLength: 300, description: 'Screens, charts or calculations it needs' },
          area: AREA,
        },
        required: ['name', 'purpose'],
      },
      run(args, { moduleState }) {
        const existing = moduleState().appRequests ?? []
        if (existing.some((r) => r.name.toLowerCase() === args.name.toLowerCase())) {
          return { error: `"${args.name}" is already on your list of app ideas.` }
        }
        return {
          summary: `Saved "${args.name}" as an app idea. Find it on the Apps page, ready to build.`,
          events: [
            {
              type: 'app.requested',
              area: args.area,
              data: { requestId: slugify(args.name), name: args.name, purpose: args.purpose, tracks: args.tracks, screens: args.screens, area: args.area },
            },
          ],
        }
      },
    },
    {
      name: 'pause_area',
      tier: 'ask',
      description: 'Pause a life area (gentle mode): no nudges or quiet-area insights. Nothing is lost.',
      input: { type: 'object', properties: { area: AREA }, required: ['area'] },
      run: (args) => ({
        summary: `Paused ${DOMAIN_MAP[args.area].name}.`,
        events: [{ type: 'area.paused', area: args.area, data: { area: args.area } }],
      }),
    },
    {
      name: 'resume_area',
      tier: 'auto',
      description: 'Resume a paused life area.',
      input: { type: 'object', properties: { area: AREA }, required: ['area'] },
      run: (args) => ({
        summary: `Resumed ${DOMAIN_MAP[args.area].name}.`,
        events: [{ type: 'area.resumed', area: args.area, data: { area: args.area } }],
      }),
    },
  ],
}
