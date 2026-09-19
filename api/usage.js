import { checkAppCode } from '../server/auth.js'
import { getSpend } from '../server/usage.js'

export default async function handler(req, res) {
  if (!checkAppCode(req)) {
    res.status(401).json({ error: 'Invalid app code.' })
    return
  }
  res.status(200).json(await getSpend())
}
