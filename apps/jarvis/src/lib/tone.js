// The mechanical half of the tone check (P5.7). Whether a line is *warm* needs a
// person to read it; whether it has an emoji, shouts, scolds or plays doctor
// can be checked by code. Everything Jarvis says from a template goes through this.

const EMOJI = /\p{Extended_Pictographic}/u

// Phrases that scold, guilt, flatter or practise medicine. Lower case, matched as substrings.
export const BANNED = [
  'you should have',
  'you failed',
  'you always',
  'you never',
  'lazy',
  'disappointed',
  'shame on',
  'as an ai',
  'i am just an ai',
  "i'm just an ai",
  'great job!',
  'amazing!',
  'you have depression',
  'you are depressed',
  'my diagnosis',
  'i diagnose you',
  'diagnosed with',
  'sounds like you have',
  'you need therapy',
  'see a doctor immediately',
  'invest in',
  'you should buy',
  'you should sell',
]

export function toneProblems(text, { maxChars = 420 } = {}) {
  const t = String(text ?? '')
  const lower = t.toLowerCase()
  const problems = []
  if (!t.trim()) problems.push('blank')
  if (EMOJI.test(t)) problems.push('emoji')
  if ((t.match(/!/g) ?? []).length > 1) problems.push('shouting')
  if (t.length > maxChars) problems.push('too long')
  for (const b of BANNED) if (lower.includes(b)) problems.push(`banned phrase: ${b}`)
  return problems
}
