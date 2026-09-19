import { checkAppCode } from '../server/auth.js'
import { mergeReminderState, clearReminderState } from '../server/kv.js'

export default async function handler(req, res) {
  if (!checkAppCode(req)) {
    res.status(401).json({ error: 'Invalid app code.' })
    return
  }

  if (req.method === 'POST') {
    const { subscription, reminderTime, timezone } = req.body || {}
    if (!subscription?.endpoint || !reminderTime || !timezone) {
      res.status(400).json({ error: 'Missing subscription, reminderTime, or timezone.' })
      return
    }
    await mergeReminderState({ subscription, reminderTime, timezone })
    res.status(200).json({ ok: true })
    return
  }

  if (req.method === 'DELETE') {
    await clearReminderState()
    res.status(200).json({ ok: true })
    return
  }

  res.status(405).json({ error: 'Method not allowed' })
}
