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

export function matchLocalIntent(text) {
  const t = String(text ?? '').trim()
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
