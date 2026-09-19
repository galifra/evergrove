import webpush from 'web-push'
import { checkCronSecret } from '../server/auth.js'
import { loadReminderState, patchDevice, removeDevice } from '../server/kv.js'
import { localDateString, localHourMinute, minutesBetween } from '../server/time.js'

// Two static UTC cron times bracket the DST range for the target local time
// (see vercel.json) — whichever one actually lands near a device's chosen
// reminderTime in real (DST-aware) local time is the one that fires.
const WINDOW_MINUTES = 35

export default async function handler(req, res) {
  // Vercel signs cron requests with this header when CRON_SECRET is set.
  if (!checkCronSecret(req)) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const state = await loadReminderState()
  const devices = Object.entries(state.devices)
  if (!devices.length) {
    res.status(200).json({ ok: true, skipped: 'no subscription' })
    return
  }

  const today = localDateString(state.timezone)
  const nowHM = localHourMinute(state.timezone)
  // Same secret as the cron: lets the owner send a test right now, ignoring the
  // time window and today's dedupe, without touching either.
  const force = new URL(req.url ?? '/', 'http://local').searchParams.get('force') === '1'

  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_CONTACT_EMAIL || 'admin@example.com'}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  )

  const results = []
  for (const [endpoint, device] of devices) {
    if (!force) {
      if (device.lastNotifiedDate === today) {
        results.push({ skipped: 'already notified today' })
        continue
      }
      if (minutesBetween(nowHM, device.reminderTime) > WINDOW_MINUTES) {
        results.push({ skipped: 'outside reminder window', nowHM, target: device.reminderTime })
        continue
      }
    }

    try {
      // Content-free on purpose: the device's service worker builds tomorrow's
      // briefing from its own data. The text here is only a fallback.
      await webpush.sendNotification(
        device.subscription,
        JSON.stringify({
          type: 'daily',
          title: 'Evergrove',
          body: 'Your briefing for tomorrow is ready. Open Evergrove to see it.',
          test: force,
        })
      )
      if (!force) await patchDevice(endpoint, { lastNotifiedDate: today })
      results.push({ sent: true })
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        // This device's subscription expired or was revoked. Drop only it.
        await removeDevice(endpoint)
        results.push({ skipped: 'subscription expired, removed' })
      } else {
        console.error('send-reminder error', err?.statusCode, err?.message)
        results.push({ error: 'send failed' })
      }
    }
  }

  const failed = results.every((r) => r.error)
  res.status(failed ? 502 : 200).json({ ok: !failed, test: force, devices: results })
}
