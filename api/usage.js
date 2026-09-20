import { authorize } from '../server/auth.js'
import { getHistory, getSpend } from '../server/usage.js'

export default async function handler(req, res) {
  if (!(await authorize(req, res))) return
  const wantsHistory = new URL(req.url ?? '/', 'http://localhost').searchParams.has('history')
  res.status(200).json(wantsHistory ? await getHistory() : await getSpend())
}
