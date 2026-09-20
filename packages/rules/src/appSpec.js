// Turns a saved app idea into a ready-to-build brief, in the same shape the
// existing apps follow (events, growth rules, actions), so it can be handed
// straight to whoever builds it.
export function appSpecMarkdown(req) {
  const lines = [
    `# App request: ${req.name}`,
    '',
    `**Purpose:** ${req.purpose}`,
    req.tracks ? `**Keeps track of:** ${req.tracks}` : null,
    req.screens ? `**Screens, charts or calculations:** ${req.screens}` : null,
    req.area ? `**Life area it grows:** ${req.area}` : null,
    '',
    '## How it must fit Evergrove',
    '- A module with its own page at `#/app/<id>`, usable without Jarvis.',
    '- Everything it stores is an append-only event in the shared log (versioned, idempotent); mistakes are fixed with correction events.',
    '- A manifest listing its actions (with a permission tier each: auto, ask first, or suggest only) so Jarvis can use it.',
    '- Growth rules saying what each event is worth on the tree. The tree never shrinks.',
    '- Marked private if it holds sensitive data, so it is never sent to the AI unless shared.',
    '- Tests, including routing phrases for Jarvis, and it must work offline.',
    '',
    `_Requested ${req.requestedAt?.slice(0, 10) ?? ''}._`,
  ]
  return lines.filter((l) => l !== null).join('\n')
}
