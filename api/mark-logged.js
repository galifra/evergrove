import { checkAppCode } from '../server/auth.js'
import { loadReminderState, mergeReminderState } from '../server/kv.js'
import { localDateString } from '../server/time.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  if (!checkAppCode(req)) {
    res.status(401).json({ error: 'Invalid app code.' })
    return
  }

  const state = await loadReminderState()
  if (!state) {
    // No push subscription set up yet — nothing to dedupe against.
    res.status(200).json({ ok: true, noop: true })
    return
  }

  await mergeReminderState({ lastEntryDate: localDateString(state.timezone) })
  res.status(200).json({ ok: true })
}
