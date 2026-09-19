import webpush from 'web-push'
import { loadReminderState, mergeReminderState, clearReminderState } from '../server/kv.js'
import { localDateString, localHourMinute, minutesBetween } from '../server/time.js'

// Two static UTC cron times bracket the DST range for the target local time
// (see vercel.json) — whichever one actually lands near the user's chosen
// reminderTime in their real (DST-aware) local time is the one that fires.
const WINDOW_MINUTES = 35

export default async function handler(req, res) {
  // Vercel signs cron requests with this header when CRON_SECRET is set.
  const auth = req.headers['authorization']
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const state = await loadReminderState()
  if (!state?.subscription) {
    res.status(200).json({ ok: true, skipped: 'no subscription' })
    return
  }

  const today = localDateString(state.timezone)
  const nowHM = localHourMinute(state.timezone)
  // Same secret as the cron: lets the owner send a test right now, ignoring
  // the time window and today's dedupe, without touching either.
  const force = new URL(req.url ?? '/', 'http://local').searchParams.get('force') === '1'

  if (!force) {
    if (state.lastNotifiedDate === today) {
      res.status(200).json({ ok: true, skipped: 'already notified today' })
      return
    }
    if (minutesBetween(nowHM, state.reminderTime) > WINDOW_MINUTES) {
      res.status(200).json({ ok: true, skipped: 'outside reminder window', nowHM, target: state.reminderTime })
      return
    }
    if (state.lastEntryDate === today) {
      await mergeReminderState({ lastNotifiedDate: today })
      res.status(200).json({ ok: true, skipped: 'already logged today' })
      return
    }
  }

  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_CONTACT_EMAIL || 'admin@example.com'}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  )

  try {
    await webpush.sendNotification(
      state.subscription,
      JSON.stringify({
        title: 'Evergrove',
        body: force
          ? "Test: your reminders work. Tonight's real one is still scheduled."
          : "Haven't heard from you today — what did you get done?",
      })
    )
    if (!force) await mergeReminderState({ lastNotifiedDate: today })
    res.status(200).json({ ok: true, sent: true, test: force })
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      // Subscription expired or was revoked — stop trying until they re-enable.
      await clearReminderState()
      res.status(200).json({ ok: true, skipped: 'subscription expired, cleared' })
      return
    }
    console.error('send-reminder error', err)
    res.status(502).json({ error: 'Failed to send push notification' })
  }
}
