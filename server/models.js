// Which model answers a request. The small, cheap model handles almost
// everything. A stronger one is used only when the client asks for a second try
// after the first answer was unusable, so it costs nothing on normal requests.
export const DEFAULT_MODEL = 'claude-haiku-4-5-20251001'
export const DEFAULT_ESCALATION_MODEL = 'claude-sonnet-5'

export function modelFor({ escalate = false } = {}, env = process.env) {
  if (escalate === true) return env.ANTHROPIC_ESCALATION_MODEL || DEFAULT_ESCALATION_MODEL
  return env.ANTHROPIC_MODEL || DEFAULT_MODEL
}
