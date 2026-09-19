import { authorize } from '../server/auth.js'
import { getSpend } from '../server/usage.js'

export default async function handler(req, res) {
  if (!(await authorize(req, res))) return
  res.status(200).json(await getSpend())
}
