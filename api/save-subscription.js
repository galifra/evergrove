import { checkAppCode } from '../server/auth.js'
import { saveDevice, removeDevice } from '../server/kv.js'

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
    await saveDevice({ subscription, reminderTime, timezone })
    res.status(200).json({ ok: true })
    return
  }

  if (req.method === 'DELETE') {
    // Only this device's subscription is removed; other devices keep theirs.
    const { endpoint } = req.body || {}
    if (typeof endpoint !== 'string' || !endpoint) {
      res.status(400).json({ error: 'Missing endpoint.' })
      return
    }
    await removeDevice(endpoint)
    res.status(200).json({ ok: true })
    return
  }

  res.status(405).json({ error: 'Method not allowed' })
}
