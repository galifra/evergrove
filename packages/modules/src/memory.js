import { effectiveEvents, localDate } from '@evergrove/core/events.js'
import { findOne } from '@evergrove/core/match.js'

// Jarvis's memory (docs/v2/MEMORY-SPEC.md): a short list of notes about you, kept so he
// behaves like a friend who remembers. Visible, editable, deletable, and never silent:
// a note is saved only when you ask ("remember that ...") or approve one he offers.

export const CATEGORIES = ['preference', 'routine', 'goal', 'person', 'fact']
export const MAX_NOTES = 200
export const MAX_PER_DAY = 20
export const MAX_TEXT = 240
const SEND_LIMIT = 12
const SEND_CHARS = 1600

let counter = 0
const uid = () => `mem-${Date.now().toString(36)}-${(counter++).toString(36)}`

export function deriveMemory(events, now = new Date()) {
  const notes = new Map()
  for (const e of effectiveEvents(events)) {
    const d = e.data
    if (e.type === 'memory.noted') {
      notes.set(d.memoryId, {
        id: d.memoryId,
        text: d.text,
        category: CATEGORIES.includes(d.category) ? d.category : 'fact',
        private: !!d.private,
        role: d.role ?? null,
        source: d.source ?? 'approved',
        notedAt: e.occurredAt,
        eventId: e.id,
      })
    } else if (e.type === 'memory.revised') {
      const n = notes.get(d.memoryId)
      if (n) {
        if (typeof d.text === 'string') n.text = d.text
        if (CATEGORIES.includes(d.category)) n.category = d.category
        if (typeof d.private === 'boolean') n.private = d.private
      }
    } else if (e.type === 'memory.forgotten') {
      notes.delete(d.memoryId)
    }
  }
  const active = [...notes.values()].sort((a, b) => a.notedAt.localeCompare(b.notedAt))
  const today = localDate(now)
  const name = [...active].reverse().find((n) => n.role === 'name')
  return {
    notes: active,
    count: active.length,
    notedToday: active.filter((n) => localDate(n.notedAt) === today).length,
    // What he calls you, when you have told him.
    name: name ? nameFromNote(name.text) : '',
  }
}

// The name note reads "Call the user Sam"; the name is whatever follows.
export const nameNote = (name) => `Call the user ${String(name).trim()}`
export const nameFromNote = (text) => String(text ?? '').replace(/^Call the user\s+/i, '').trim()

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

// ---- guessing a category and whether a note is sensitive ---------------------

export function guessCategory(text) {
  const t = norm(text)
  if (/\b(mom|mother|dad|father|wife|husband|partner|girlfriend|boyfriend|friend|brother|sister|son|daughter|kid|kids|boss|coworker|neighbor)\b/.test(t)) return 'person'
  if (/\b(every|each|usually|always|routine|on weekdays|on weekends|mornings?|evenings?|nights?)\b/.test(t) && !/\b(best|prefer|love|like)\b/.test(t)) return 'routine'
  if (/\b(goal|trying to|working (on|toward|towards)|want to|plan to|aiming|saving for|training for)\b/.test(t)) return 'goal'
  if (/\b(prefer|like|love|hate|dislike|favorite|favourite|best|enjoy|can't stand|cannot stand)\b/.test(t)) return 'preference'
  return 'fact'
}

// Errs on the side of private: a wrongly private note is only hidden, a wrongly public one is shared.
export function looksPrivate(text) {
  return /\b(therap|medicat|prescri|diagnos|depress|anxiety|panic|doctor|surgery|pregnan|debt|salary|income|owe|loan|mortgage|password|passcode|pin\b|ssn|social security|divorce|lawyer|court|affair|addict|sober|relapse)/i.test(String(text ?? ''))
}

// ---- what he is told ---------------------------------------------------------

const STOP = new Set(['the', 'and', 'for', 'that', 'this', 'with', 'you', 'your', 'are', 'was', 'have', 'has', 'what', 'when', 'how', 'can', 'not', 'but', 'all', 'about', 'from', 'they', 'them', 'his', 'her', 'its', 'just', 'like', 'get', 'got', 'did', 'does', 'any', 'out', 'too', 'now', 'i\'m', 'ive', 'im'])
// A light stem so "mornings", "morning" and "runs", "run" match each other.
const stem = (w) => {
  let x = w.length > 3 ? w.replace(/s$/, '') : w
  if (x.length > 5) x = x.replace(/(ing|ed)$/, '')
  return x
}
const words = (s) => norm(s).split(/[^a-z0-9']+/).filter((w) => w.length > 2 && !STOP.has(w)).map(stem)
const WEIGHT = { preference: 3, routine: 3, goal: 3, person: 2, fact: 1 }

// Picks the notes worth telling him for this message, by a local rule and no AI:
// private notes are left out unless shared; score = category weight + 2 per shared
// word + 1 if noted in the last 30 days; then the top 12, stopping at about 1,600 characters.
export function selectMemories(notes, message, { shared = [], now = new Date() } = {}) {
  const want = new Set(words(message))
  const cutoff = now.getTime() - 30 * 86400000
  const scored = notes
    .filter((n) => !n.private || shared.includes('memory'))
    .map((n) => {
      const overlap = words(n.text).filter((w) => want.has(w)).length
      const recent = new Date(n.notedAt).getTime() >= cutoff ? 1 : 0
      return { n, score: (n.role === 'name' ? 100 : WEIGHT[n.category] ?? 1) + overlap * 2 + recent }
    })
    .sort((a, b) => b.score - a.score || b.n.notedAt.localeCompare(a.n.notedAt))
  const out = []
  let chars = 0
  for (const { n } of scored) {
    if (out.length >= SEND_LIMIT || chars + n.text.length > SEND_CHARS) break
    out.push(n)
    chars += n.text.length
  }
  return out
}

// The lines that go into a request. Marked as data, one note per line.
export function memoryLines(selected) {
  return selected.map((n) => `- (${n.category}) ${n.text.replace(/\s+/g, ' ')}`).join('\n')
}

// A note that matches what the user said, for "forget ...": exact text first, then by shared words.
export function findNotes(notes, query) {
  const q = norm(query)
  if (!q) return []
  const exact = notes.filter((n) => norm(n.text) === q)
  if (exact.length) return exact
  const inside = notes.filter((n) => norm(n.text).includes(q))
  if (inside.length) return inside
  const want = words(q)
  if (!want.length) return []
  const scored = notes.map((n) => ({ n, hits: words(n.text).filter((w) => want.includes(w)).length })).filter((x) => x.hits > 0)
  const best = Math.max(0, ...scored.map((x) => x.hits))
  return scored.filter((x) => x.hits === best && best >= Math.min(2, want.length)).map((x) => x.n)
}

export const memoryModule = {
  id: 'memory',
  name: 'Memory',
  icon: 'brain',
  area: null,
  description: 'Short notes MOXIE keeps about you, so he behaves like a friend who remembers.',
  hidden: true,
  // A note's privacy is its own flag, so the module's summary is never sent (notes go separately, chosen by rule).
  derive: deriveMemory,
  actions: [
    {
      name: 'remember',
      tier: 'ask',
      description:
        'Save a short note about the user for later, ONLY for something lasting they told you about themselves (a preference, routine, goal, person or fact). Not for one-off events or things they did today. It asks the user before saving. Set private=true for anything about health, mental health, money, relationships or otherwise sensitive.',
      input: {
        type: 'object',
        properties: {
          text: { type: 'string', maxLength: MAX_TEXT, description: 'One idea, in the third person or plainly, e.g. "Runs best in the morning"' },
          category: { type: 'string', enum: CATEGORIES },
          private: { type: 'boolean' },
          role: { type: 'string', enum: ['name'], description: 'Only for the name the user wants to be called' },
          via: { type: 'string', enum: ['command', 'approved'], description: 'Set by the app, not by you' },
        },
        required: ['text'],
      },
      run(args, { moduleState }) {
        const text = args.text.trim().replace(/\s+/g, ' ')
        if (!text) return { error: 'There is nothing to remember there.' }
        const state = moduleState()
        if (state.count >= MAX_NOTES) return { error: `Memory is full (${MAX_NOTES} notes). Forget a few first.` }
        if (state.notedToday >= MAX_PER_DAY) return { error: `That is ${MAX_PER_DAY} new notes today. Try again tomorrow.` }
        if (state.notes.some((n) => norm(n.text) === norm(text))) return { error: 'I already have that noted.' }
        const isPrivate = args.private ?? looksPrivate(text)
        return {
          summary: `Noted: "${text}"${isPrivate ? ' (private)' : ''}.`,
          events: [
            {
              type: 'memory.noted',
              data: {
                memoryId: uid(),
                text,
                category: args.category ?? guessCategory(text),
                private: isPrivate,
                role: args.role,
                source: args.via ?? 'approved',
              },
            },
          ],
        }
      },
    },
    {
      name: 'forget',
      tier: 'ask',
      description: 'Remove a note MOXIE kept about the user (identify it by its words). It asks the user before removing.',
      input: { type: 'object', properties: { note: { type: 'string', maxLength: MAX_TEXT } }, required: ['note'] },
      run(args, { moduleState }) {
        const r = findOne(moduleState().notes, args.note, { label: (n) => n.text, noun: 'note' })
        if (r.error) return { error: r.error }
        return { summary: `Forgot: "${r.item.text}".`, events: [{ type: 'memory.forgotten', data: { memoryId: r.item.id } }] }
      },
    },
    {
      name: 'revise',
      tier: 'ask',
      description: 'Change the words, category or privacy of a note (identify it by its current words).',
      input: {
        type: 'object',
        properties: {
          note: { type: 'string', maxLength: MAX_TEXT },
          text: { type: 'string', maxLength: MAX_TEXT },
          category: { type: 'string', enum: CATEGORIES },
          private: { type: 'boolean' },
        },
        required: ['note'],
      },
      run(args, { moduleState }) {
        const r = findOne(moduleState().notes, args.note, { label: (n) => n.text, noun: 'note' })
        if (r.error) return { error: r.error }
        const data = { memoryId: r.item.id }
        if (typeof args.text === 'string' && args.text.trim()) data.text = args.text.trim().replace(/\s+/g, ' ')
        if (args.category) data.category = args.category
        if (typeof args.private === 'boolean') data.private = args.private
        if (Object.keys(data).length === 1) return { error: 'Nothing to change.' }
        return { summary: `Updated the note "${r.item.text}".`, events: [{ type: 'memory.revised', data }] }
      },
    },
  ],
}
