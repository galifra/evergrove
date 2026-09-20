// Reply templates (P5.4). Routine answers (done, waiting for approval, an error,
// "I didn't follow") cost nothing and never come back blank. They are written in
// Jarvis's voice: short, dry, no emoji, no exclamation marks. When the assistant
// has words of its own, those are used instead.

export const TEMPLATES = {
  done: ['Done.', 'Done. All in.', 'Taken care of.'],
  doneOne: ['Done.', 'That is in.', 'Sorted.'],
  approval: ['That one needs your say. Approve it below.', 'I will wait for your word on that one.', 'Your call on that. Approve it below or skip it.'],
  suggestOnly: ["I can suggest that, but it is not mine to do.", 'That is one for you to do. I can only point.'],
  unsure: ["I'm not sure what to do with that. Can you say it another way?", 'That one lost me. Try it another way?', 'I did not catch a request in that. What would you like me to do?'],
  cleared: ['Chat cleared.'],
  nothingToUndo: ["There's nothing recent to undo."],
}

// A stable choice from a list: the same seed always gives the same line, so a
// reply never changes when the page redraws, yet different requests vary.
export function pick(list, seed = '') {
  let h = 0
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return list[h % list.length]
}

const tidy = (msg) => String(msg ?? '').trim().replace(/\s+/g, ' ').replace(/[.!]+$/, '')

// The words to show under a reply. `steps` are the actions that ran or are waiting.
export function replyFor({ text, steps = [], seed = '' }) {
  const said = String(text ?? '').trim()
  if (said) return said
  if (!steps.length) return pick(TEMPLATES.unsure, seed)
  const errors = steps.filter((s) => s.status === 'error')
  if (errors.length) return `That did not go through: ${tidy(errors[0].result ?? errors[0].error) || 'something went wrong'}.`
  if (steps.some((s) => s.status === 'needs-approval')) return pick(TEMPLATES.approval, seed)
  if (steps.every((s) => s.status === 'suggest-only')) return pick(TEMPLATES.suggestOnly, seed)
  return pick(steps.length === 1 ? TEMPLATES.doneOne : TEMPLATES.done, seed)
}

// Every fixed line, for the tone test.
export const allTemplateLines = () => Object.values(TEMPLATES).flat()
