import { useState } from 'react'
import { motion } from 'framer-motion'
import { requestNotificationPermission, notificationsSupported } from '../lib/notifications'

export default function Onboarding({ onFinish }) {
  const [name, setName] = useState('My Grove')
  const [reminderTime, setReminderTime] = useState('21:00')
  const [wantsReminder, setWantsReminder] = useState(true)

  async function finish() {
    let reminderEnabled = false
    if (wantsReminder && notificationsSupported()) {
      const perm = await requestNotificationPermission()
      reminderEnabled = perm === 'granted'
    }
    onFinish({ treeName: name.trim() || 'My Grove', reminderTime, reminderEnabled })
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#060a08] p-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.03] p-6"
      >
        <p className="text-4xl mb-3">🌱</p>
        <h1 className="font-display text-2xl mb-2">Welcome to Evergrove</h1>
        <p className="text-white/60 text-sm mb-6">
          Tell it what you just did — a workout, a chapter read, a hard conversation, a habit kept
          — and it grows a real branch for it. Every part of your life gets its own limb.
        </p>

        <label className="block mb-4">
          <span className="text-white/60 text-xs">Name your tree</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 focus:outline-none focus:border-emerald-400/50"
          />
        </label>

        <div className="rounded-xl border border-white/10 p-3 mb-6">
          <label className="flex items-center justify-between">
            <span className="text-sm">End-of-day reminder</span>
            <input
              type="checkbox"
              checked={wantsReminder}
              onChange={(e) => setWantsReminder(e.target.checked)}
              className="w-4 h-4 accent-emerald-500"
            />
          </label>
          {wantsReminder && (
            <input
              type="time"
              value={reminderTime}
              onChange={(e) => setReminderTime(e.target.value)}
              className="mt-2 rounded-lg bg-white/5 border border-white/10 px-3 py-1.5"
            />
          )}
          <p className="text-[11px] text-white/35 mt-2">
            You can change this any time from the buddy widget in the corner.
          </p>
        </div>

        <button
          onClick={finish}
          className="w-full rounded-xl bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-medium py-2.5 transition-colors"
        >
          Plant it
        </button>
      </motion.div>
    </div>
  )
}
