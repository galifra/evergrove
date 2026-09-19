import { timingSafeEqual } from 'node:crypto'
import { getKv } from './store.js'

// Constant-time comparison so a wrong guess can't be refined by response timing.
export function safeEqual(a, b) {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}

// Fails closed in production: a deployment missing APP_ACCESS_CODE rejects
// everything instead of quietly becoming public. Only local dev runs open.
export function checkAppCode(req) {
  const required = process.env.APP_ACCESS_CODE
  if (!required) return process.env.VERCEL_ENV !== 'production'
  return safeEqual(req.headers['x-app-code'] ?? '', required)
}

// The reminder job is called by Vercel Cron (or by you for a test) with
// `Authorization: Bearer $CRON_SECRET`. With no secret configured nothing is
// allowed, in any environment.
export function checkCronSecret(req) {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return safeEqual(req.headers['authorization'] ?? '', `Bearer ${secret}`)
}

const MAX_FAILURES = 20
const WINDOW_SECONDS = 3600

function clientKey(req) {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim()
  return `evergrove:authfail:${forwarded || 'unknown'}`
}

// The one gate every API route uses. Wrong codes are counted per address; after
// 20 in an hour that address is refused (even with the right code) until the hour
// is up, so the code can't be guessed by brute force.
export async function authorize(req, res) {
  const kv = getKv()
  const key = clientKey(req)
  const failures = Number((await kv.get(key)) ?? 0)
  if (failures >= MAX_FAILURES) {
    res.status(429).json({ error: 'Too many wrong codes. Try again in an hour.' })
    return false
  }
  if (checkAppCode(req)) return true
  await kv.set(key, failures + 1, { ex: WINDOW_SECONDS })
  res.status(401).json({ error: 'Invalid app code.' })
  return false
}
