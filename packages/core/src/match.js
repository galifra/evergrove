// Resolves a spoken reference ("the dentist thing") to one item, or explains
// why it can't. Never guesses between several candidates.
export function findOne(items, query, { id = (x) => x.id, label = (x) => x.title, noun = 'item' } = {}) {
  const q = String(query ?? '').trim().toLowerCase()
  if (!q) return { error: `Which ${noun}?` }

  const byId = items.find((x) => String(id(x)).toLowerCase() === q)
  if (byId) return { item: byId }

  const exact = items.filter((x) => label(x).trim().toLowerCase() === q)
  if (exact.length === 1) return { item: exact[0] }

  const partial = items.filter((x) => label(x).toLowerCase().includes(q) || q.includes(label(x).toLowerCase()))
  if (partial.length === 1) return { item: partial[0] }
  if (partial.length > 1) {
    return { error: `Several ${noun}s match "${query}": ${partial.slice(0, 5).map(label).join('; ')}. Which one?` }
  }
  return { error: `I couldn't find a ${noun} matching "${query}".` }
}
