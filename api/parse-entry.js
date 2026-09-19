import Anthropic from '@anthropic-ai/sdk'
import { authorize } from '../server/auth.js'
import { budgetAllows, recordUsage } from '../server/usage.js'

// Fixed domain set — kept in sync with src/lib/domains.js. Duplicated here
// (rather than imported) because this file runs as an isolated serverless
// function outside the Vite client bundle.
const DOMAIN_IDS = ['health', 'mind', 'discipline', 'craft', 'social', 'creativity', 'inner']
const DOMAIN_LABELS = {
  health: 'Health & Fitness',
  mind: 'Mind & Learning',
  discipline: 'Discipline & Habits',
  craft: 'Craft & Career',
  social: 'Relationships & Social',
  creativity: 'Creativity & Expression',
  inner: 'Inner Life & Purpose',
}

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001'

const TOOL = {
  name: 'apply_tree_updates',
  description:
    "Record skill growth on the user's life skill tree based on one free-text activity log entry.",
  input_schema: {
    type: 'object',
    properties: {
      updates: {
        type: 'array',
        maxItems: 6,
        description:
          'One entry per distinct skill the activity demonstrates. Empty array if the text describes no concrete accomplishable activity.',
        items: {
          type: 'object',
          properties: {
            domain: { type: 'string', enum: DOMAIN_IDS },
            skillId: {
              type: 'string',
              description:
                'kebab-case id. Reuse an existing id from the provided skill list if this activity clearly matches it; otherwise a new short kebab-case id.',
            },
            skillName: { type: 'string', description: 'Short human-readable display name, e.g. "Running".' },
            xpGain: {
              type: 'integer',
              minimum: 1,
              maximum: 40,
              description:
                'How much this specific activity is worth, 1-40. Small/quick things: 3-8. A solid focused session: 10-20. A major or unusually long effort: 25-40. Be conservative and consistent, not generous.',
            },
            reason: { type: 'string', description: 'One short clause justifying the xp amount.' },
          },
          required: ['domain', 'skillId', 'skillName', 'xpGain', 'reason'],
        },
      },
      summary: {
        type: 'string',
        description:
          'One short, warm, specific sentence said directly to the user about what they just logged. If updates is empty, gently say you could not find anything concrete to log and ask them to rephrase.',
      },
    },
    required: ['updates', 'summary'],
  },
}

function buildSystemPrompt(existingSkills) {
  const domainList = DOMAIN_IDS.map((id) => `- ${id}: ${DOMAIN_LABELS[id]}`).join('\n')
  const existingList = Object.entries(existingSkills || {})
    .filter(([, skills]) => skills && skills.length)
    .map(([domain, skills]) => `${domain}: ${skills.map((s) => `${s.id} ("${s.name}")`).join(', ')}`)
    .join('\n')

  return `You maintain a personal life "skill tree" for the user. They tell you what they just did, in their own words, and you translate it into precise, conservative XP updates.

Life domains (use these exact ids only):
${domainList}

Existing skills already on the tree (reuse these skillIds when the entry clearly matches one — do not create a near-duplicate like "run" next to an existing "running"):
${existingList || '(none yet — this is a fresh tree)'}

Rules:
- Only log things the user actually says they did. Never invent activities.
- A single entry can touch multiple skills/domains if it genuinely describes multiple things (e.g. "ran 3 miles then read for 20 min" -> two updates).
- If the entry is vague, is a question, or describes no completed activity, return an empty updates array and ask a brief clarifying question in "summary".
- Keep xpGain conservative and consistent with the scale described in the tool schema — this app is used daily for months, so it must not inflate.
- Always call the apply_tree_updates tool. Never respond in plain text.`
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  if (!(await authorize(req, res))) return

  const { text, existingSkills } = req.body || {}
  if (!text || typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'Missing "text".' })
    return
  }
  if (text.length > 800) {
    res.status(400).json({ error: 'That entry is too long — try to keep it to a sentence or two.' })
    return
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY.' })
    return
  }

  if (!(await budgetAllows())) {
    res.status(429).json({ error: 'Monthly AI budget reached. It resets next month, or raise AI_MONTHLY_CAP_USD.' })
    return
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: buildSystemPrompt(existingSkills),
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'apply_tree_updates' },
      messages: [{ role: 'user', content: text.trim() }],
    })

    await recordUsage(message.usage, MODEL)

    const toolUse = message.content.find((b) => b.type === 'tool_use' && b.name === 'apply_tree_updates')
    if (!toolUse) {
      res.status(502).json({ error: 'The model did not return a structured update. Try again.' })
      return
    }

    const input = toolUse.input || {}
    const rawUpdates = Array.isArray(input.updates) ? input.updates : []

    // Defensive server-side validation — never trust the model blindly,
    // even with a forced tool schema.
    const updates = rawUpdates
      .filter((u) => u && DOMAIN_IDS.includes(u.domain) && u.skillId && u.skillName)
      .slice(0, 6)
      .map((u) => ({
        domain: u.domain,
        skillId: String(u.skillId).slice(0, 60),
        skillName: String(u.skillName).slice(0, 60),
        xpGain: Math.max(1, Math.min(40, Math.round(Number(u.xpGain) || 0))),
        reason: String(u.reason || '').slice(0, 200),
      }))

    res.status(200).json({
      updates,
      summary: String(input.summary || '').slice(0, 300),
    })
  } catch (err) {
    console.error('parse-entry error', err)
    res.status(502).json({ error: 'Could not reach the model. Please try again.' })
  }
}
