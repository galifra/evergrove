import { useState } from 'react'
import { motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import { useApp } from '../app/AppContext'
import { setAccessCode } from '../lib/storage'
import { pushSupported, enablePushReminders } from '../lib/push'

function explain(err) {
  const m = err?.message ?? ''
  if (/\b401\b/.test(m)) return "That access code wasn't accepted."
  return m || 'Could not connect.'
}

export default function Onboarding({ onFinish }) {
  const { runtime, updateSettings } = useApp()
  const [name, setName] = useState('My Grove')
  const [reminderTime, setReminderTime] = useState('21:00')
  const [wantsReminder, setWantsReminder] = useState(true)
  const [linking, setLinking] = useState(false)
  const [code, setCode] = useState('')
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function finish() {
    let reminderEnabled = false
    if (wantsReminder && pushSupported()) {
      try {
        await enablePushReminders(reminderTime)
        reminderEnabled = true
      } catch {
        reminderEnabled = false
      }
    }
    onFinish({ treeName: name.trim() || 'My Grove', reminderTime, reminderEnabled })
  }

  // Second device: bring everything over from the encrypted relay instead of
  // starting a new grove.
  async function connect(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      setAccessCode(code.trim())
      await runtime.sync.configure(pass.trim())
      const r = await runtime.sync.syncNow()
      if (!r.pulled && runtime.log.getEvents().length === 0) {
        throw new Error('Connected, but nothing is stored under that passphrase. Check it matches your other device exactly.')
      }
      updateSettings({ syncPassphrase: pass.trim(), onboarded: true })
      runtime.configureSync(pass.trim())
    } catch (err) {
      setError(explain(err))
    } finally {
      setBusy(false)
    }
  }

  const field =
    'w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 focus:outline-none focus:border-emerald-400/50 placeholder:text-white/25'

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#060a08] p-4">
      <div className="min-h-full grid place-items-center">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.03] p-6 my-4"
        >
          <p className="text-4xl mb-3">🌱</p>
          <h1 className="font-display text-2xl mb-2">Welcome to Evergrove</h1>
          <p className="text-white/60 text-sm mb-5">
            Tell it what you just did — a workout, a chapter read, a hard conversation, a habit kept — and it grows a real
            branch for it. Every part of your life gets its own limb.
          </p>

          {!linking ? (
            <>
              <label className="block mb-4">
                <span className="text-white/60 text-xs">Name your tree</span>
                <input value={name} onChange={(e) => setName(e.target.value)} className={`mt-1 ${field}`} />
              </label>

              <div className="rounded-xl border border-white/10 p-3 mb-5">
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
                <p className="text-[11px] text-white/55 mt-2">
                  On iPhone, reminders only work once Evergrove is added to your Home Screen. You can change this later in
                  Settings.
                </p>
              </div>

              <button
                onClick={finish}
                className="w-full rounded-xl bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-medium py-2.5 transition-colors"
              >
                Plant it
              </button>
              <button onClick={() => setLinking(true)} className="mt-4 w-full text-sm text-white/50 hover:text-white/80 underline">
                I already use Evergrove on another device
              </button>
            </>
          ) : (
            <form onSubmit={connect} className="space-y-3">
              <p className="text-sm text-white/70">
                Enter the same access code and sync passphrase you use on your other device. Your data is decrypted here on
                this device only.
              </p>
              <label className="block">
                <span className="text-white/60 text-xs">Access code</span>
                <input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" className={`mt-1 ${field}`} />
              </label>
              <label className="block">
                <span className="text-white/60 text-xs">Sync passphrase</span>
                <input
                  type="password"
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                  autoComplete="off"
                  className={`mt-1 ${field}`}
                />
              </label>
              {error && <p className="text-sm text-rose-300">{error}</p>}
              <button
                type="submit"
                disabled={busy || !pass.trim()}
                className="w-full rounded-xl bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-medium py-2.5 disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {busy && <Loader2 size={15} className="animate-spin" />} Connect this device
              </button>
              <button type="button" onClick={() => setLinking(false)} className="w-full text-sm text-white/50 hover:text-white/80 underline">
                Back
              </button>
            </form>
          )}
        </motion.div>
      </div>
    </div>
  )
}
