import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(async (sub) => {
      if (sub.endpoint.includes('gone')) throw Object.assign(new Error('gone'), { statusCode: 410 })
    }),
  },
}))

import webpush from 'web-push'
import saveHandler from '../api/save-subscription.js'
import sendHandler from '../api/send-reminder.js'
import { getKv } from './store.js'
import { loadReminderState, normalize } from './kv.js'
import { localDateString, localHourMinute } from './time.js'

process.env.CRON_SECRET = 'cron-secret'
delete process.env.APP_ACCESS_CODE

function call(handler, { method = 'POST', url = '/', body, headers = {} } = {}) {
  return new Promise((resolve) => {
    const res = {
      code: 200,
      status(c) {
        this.code = c
        return this
      },
      json(obj) {
        resolve({ code: this.code, body: obj })
      },
    }
    handler({ method, url, body, headers }, res)
  })
}

const cron = { authorization: 'Bearer cron-secret' }
const sub = (name) => ({ endpoint: `https://push.example/${name}`, keys: { p256dh: 'x', auth: 'y' } })
const save = (name, reminderTime = '21:00') =>
  call(saveHandler, { body: { subscription: sub(name), reminderTime, timezone: 'UTC' } })

beforeEach(async () => {
  await getKv().del('evergrove:reminder')
  vi.mocked(webpush.sendNotification).mockClear()
})

describe('reminders across several devices', () => {
  it('keeps a subscription per device instead of overwriting', async () => {
    await save('laptop')
    await save('phone')
    const state = await loadReminderState()
    expect(Object.keys(state.devices).sort()).toEqual(['https://push.example/laptop', 'https://push.example/phone'])
  })

  it('turning reminders off on the phone leaves the laptop alone', async () => {
    await save('laptop')
    await save('phone')
    const r = await call(saveHandler, { method: 'DELETE', body: { endpoint: sub('phone').endpoint } })
    expect(r.code).toBe(200)
    expect(Object.keys((await loadReminderState()).devices)).toEqual(['https://push.example/laptop'])
    expect((await call(saveHandler, { method: 'DELETE', body: {} })).code).toBe(400)
  })

  it('folds an old single-subscription record into the device map', () => {
    const n = normalize({ subscription: sub('old'), reminderTime: '20:30', timezone: 'America/Chicago', lastEntryDate: '2026-09-01' })
    expect(n.devices['https://push.example/old']).toMatchObject({ reminderTime: '20:30' })
    expect(n.timezone).toBe('America/Chicago')
    expect(n.lastEntryDate).toBe('2026-09-01')
  })

  it('re-saving a device updates its time and keeps its dedupe date', async () => {
    await save('laptop', '21:00')
    await save('laptop', '22:00')
    expect((await loadReminderState()).devices[sub('laptop').endpoint].reminderTime).toBe('22:00')
  })
})

describe('the reminder job', () => {
  const now = () => localHourMinute('UTC')
  // twelve hours from now, so it can never fall inside the 35 minute window
  const far = () => {
    const [h, m] = now().split(':')
    return `${String((Number(h) + 12) % 24).padStart(2, '0')}:${m}`
  }

  it('refuses requests without the cron secret', async () => {
    expect((await call(sendHandler, { method: 'GET' })).code).toBe(401)
  })

  it('does nothing when no device has reminders on', async () => {
    const r = await call(sendHandler, { method: 'GET', headers: cron })
    expect(r.body.skipped).toBe('no subscription')
  })

  it('sends only to devices whose time is near now, once per day', async () => {
    await save('laptop', now())
    await save('phone', far())
    const first = await call(sendHandler, { method: 'GET', headers: cron })
    expect(first.body.devices.map((d) => Boolean(d.sent))).toEqual([true, false])
    expect(webpush.sendNotification).toHaveBeenCalledTimes(1)
    const again = await call(sendHandler, { method: 'GET', headers: cron })
    expect(again.body.devices[0].skipped).toBe('already notified today')
    expect(webpush.sendNotification).toHaveBeenCalledTimes(1)
  })

  it('sends only a content-free wake-up: no names, dates or amounts ever leave for the server', async () => {
    await save('laptop', now())
    await call(sendHandler, { method: 'GET', headers: cron })
    const [, payload] = vi.mocked(webpush.sendNotification).mock.calls[0]
    expect(JSON.parse(payload)).toEqual({
      type: 'daily',
      title: 'Evergrove',
      body: 'Your briefing for tomorrow is ready. Open Evergrove to see it.',
      test: false,
    })
  })

  it('still sends on days you logged something (the briefing is the point)', async () => {
    await save('laptop', now())
    const state = await loadReminderState()
    state.lastEntryDate = localDateString('UTC')
    await getKv().set('evergrove:reminder', state)
    const r = await call(sendHandler, { method: 'GET', headers: cron })
    expect(r.body.devices[0].sent).toBe(true)
  })

  it('a test send reaches every device and does not use up the real reminder', async () => {
    await save('laptop', '03:33')
    await save('phone', '04:44')
    const r = await call(sendHandler, { method: 'GET', url: '/api/send-reminder?force=1', headers: cron })
    expect(r.body.devices.every((d) => d.sent)).toBe(true)
    const state = await loadReminderState()
    expect(Object.values(state.devices).every((d) => d.lastNotifiedDate === null)).toBe(true)
  })

  it('removes only the expired device, keeps the rest', async () => {
    await save('laptop', now())
    await save('gone', now())
    const r = await call(sendHandler, { method: 'GET', headers: cron })
    expect(r.body.devices.some((d) => d.skipped === 'subscription expired, removed')).toBe(true)
    expect(Object.keys((await loadReminderState()).devices)).toEqual(['https://push.example/laptop'])
  })
})
