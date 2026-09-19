import { timingSafeEqual } from 'node:crypto'

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
