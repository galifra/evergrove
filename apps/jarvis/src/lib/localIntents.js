// Rules before AI: a handful of short, exact commands are handled right on the
// device. They cost nothing, answer instantly, work offline, and can't be
// misunderstood by a model. Anything that isn't an exact match goes to the AI as
// usual, so these patterns are deliberately strict.

const PATTERNS = [
  ['undo', /^(please )?undo( that| it| this| the last( one| thing| action)?)?[.!]?$/i],
  [
    'briefing',
    /^(brief me( on tomorrow)?|(give me )?(a |my )?(tomorrow'?s? )?(briefing|brief)( for tomorrow)?|what'?s (on )?tomorrow\??|what do i have (on )?tomorrow\??|tomorrow'?s? (schedule|plan|agenda|briefing))[.!?]*$/i,
  ],
  [
    'today',
    /^(what'?s (on )?(today|my day)\??|what do i have (on )?today\??|today'?s? (schedule|plan|agenda)|(show )?my day|what needs me( today)?\??)[.!?]*$/i,
  ],
  ['clear', /^clear( the)?( chat| conversation)?[.!]?$/i],
  ['help', /^(help|what can you do\??|what can i say\??)$/i],
]

// Memory commands (docs/v2/MEMORY-SPEC.md). Typed by the user, so they are the user's own
// command and need no extra approval. "remember to ..." is a reminder, not a fact, so it is left
// for the assistant to turn into a task.
const REMEMBER = [
  /^remember[:,]?\s+that\s+(.+)$/is,
  /^remember:\s*(.+)$/is,
  /^remember\s+((?:i|i'm|i've|i'll|i'd|my|we|we're|our|he|she|they|his|her|their)\b.+)$/is,
]
const CALL_ME = /^(?:call me|my name is|you can call me|i go by)\s+([\p{L}][\p{L}.' -]{0,38})[.!]?$/iu
const FORGET_LAST = /^forget\s+(?:that|the last (?:thing|one)|what i just (?:said|told you))[.!]?$/i
const FORGET_ABOUT = /^forget\s+(?:what i (?:told|said to) you about\s+|about\s+|that\s+)?(.{3,120})$/i
const NOT_A_NAME = new Set(['later', 'back', 'tomorrow', 'today', 'tonight', 'now', 'soon', 'maybe', 'when', 'if', 'anytime', 'please'])
const NOT_A_TARGET = /^(it|this|nothing|everything|all|that)[.!]?$/i
const LIST_MEMORY = /^(what do you (remember|know) about me|what have you (saved|noted|remembered)|show (me )?(my )?(memory|memories|notes))[.!?]*$/i

function matchMemoryIntent(t) {
  for (const re of REMEMBER) {
    const m = t.match(re)
    if (m) return { type: 'remember', text: m[1].trim().replace(/[.!]+$/, '') }
  }
  const call = t.match(CALL_ME)
  if (call && !NOT_A_NAME.has(call[1].trim().toLowerCase())) return { type: 'callme', name: call[1].trim() }
  if (LIST_MEMORY.test(t)) return { type: 'memories' }
  if (FORGET_LAST.test(t)) return { type: 'forget', last: true }
  const about = t.match(FORGET_ABOUT)
  if (about && !NOT_A_TARGET.test(about[1].trim())) return { type: 'forget', query: about[1].trim().replace(/[.!]+$/, '') }
  return null
}

export function matchLocalIntent(text) {
  const t = String(text ?? '').trim()
  if (t && t.length <= 300) {
    const memory = matchMemoryIntent(t)
    if (memory) return memory
  }
  if (!t || t.length > 60) return null
  for (const [type, re] of PATTERNS) if (re.test(t)) return { type }
  return null
}

export const HELP_TEXT = [
  'Just tell me what you did or what you need. For example:',
  '- "ran 30 minutes and read 20 pages"',
  '- "add dentist tomorrow at 3pm"',
  '- "I spent $12 on lunch"',
  '- "make me a tracker for houseplants"',
  'Quick commands that work instantly: "brief me" (tomorrow), "what\'s today", "undo", "clear".',
  'I always ask before changing or deleting something that matters, and every action has an undo.',
].join('\n')
