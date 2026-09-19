import { checkAppCode } from '../server/auth.js'
import { loadReminderState, markLoggedToday } from '../server/kv.js'
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
  if (!Object.keys(state.devices).length) {
    // No device has reminders on — nothing to dedupe against.
    res.status(200).json({ ok: true, noop: true })
    return
  }

  await markLoggedToday(localDateString(state.timezone))
  res.status(200).json({ ok: true })
}
