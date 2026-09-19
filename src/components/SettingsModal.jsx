import { useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Download, Upload, X } from 'lucide-react'
import { exportStateAsFile, getAccessCode, setAccessCode } from '../lib/storage'
import { pushSupported, enablePushReminders, disablePushReminders } from '../lib/push'

export default function SettingsModal({ state, updateSettings, renameTree, resetAll, importState, onClose }) {
  const [name, setName] = useState(state.treeName)
  const [code, setCode] = useState(getAccessCode())
  const [reminderError, setReminderError] = useState('')
  const [reminderBusy, setReminderBusy] = useState(false)
  const fileRef = useRef(null)

  async function handleReminderToggle(checked) {
    setReminderError('')
    setReminderBusy(true)
    try {
      if (checked) {
        await enablePushReminders(state.settings.reminderTime)
        updateSettings({ reminderEnabled: true })
      } else {
        await disablePushReminders()
        updateSettings({ reminderEnabled: false })
      }
    } catch (err) {
      setReminderError(err.message || 'Could not update reminder settings.')
      updateSettings({ reminderEnabled: false })
    } finally {
      setReminderBusy(false)
    }
  }

  async function handleReminderTimeChange(value) {
    updateSettings({ reminderTime: value })
    if (state.settings.reminderEnabled) {
      // re-subscribe so the server has the updated time
      try {
        await enablePushReminders(value)
      } catch {
        // non-fatal — they can re-toggle if this silently fails
      }
    }
  }

  function handleImportFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result)
        importState(parsed)
      } catch {
        alert('Could not read that file — is it a valid Evergrove backup?')
      }
    }
    reader.readAsText(file)
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0e1a13] p-5 shadow-2xl"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-xl">Settings</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5 text-sm">
          <label className="block">
            <span className="text-white/60 text-xs">Tree name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => renameTree(name.trim() || 'My Grove')}
              className="mt-1 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 focus:outline-none focus:border-emerald-400/50"
            />
          </label>

          <div className="rounded-xl border border-white/10 p-3">
            <div className="flex items-center justify-between">
              <span className="text-white/80">Daily reminder</span>
              <input
                type="checkbox"
                checked={state.settings.reminderEnabled}
                disabled={reminderBusy}
                onChange={(e) => handleReminderToggle(e.target.checked)}
                className="w-4 h-4 accent-emerald-500"
              />
            </div>
            {!pushSupported() && (
              <p className="text-xs text-amber-300/80 mt-1">
                This browser doesn't support push notifications.
              </p>
            )}
            {reminderError && <p className="text-xs text-rose-300 mt-1">{reminderError}</p>}
            <p className="text-xs text-white/40 mt-1">
              A real notification, even if Evergrove isn't open — only if nothing's logged
              that day.
            </p>
            <input
              type="time"
              value={state.settings.reminderTime}
              onChange={(e) => handleReminderTimeChange(e.target.value)}
              className="mt-2 rounded-lg bg-white/5 border border-white/10 px-3 py-1.5"
            />
          </div>

          <label className="block">
            <span className="text-white/60 text-xs">App access code</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onBlur={() => setAccessCode(code.trim())}
              placeholder="only needed if you set APP_ACCESS_CODE on the server"
              className="mt-1 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 focus:outline-none focus:border-emerald-400/50 placeholder:text-white/25"
            />
          </label>

          <div className="flex gap-2">
            <button
              onClick={() => exportStateAsFile(state)}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 py-2"
            >
              <Download size={14} /> Export
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 py-2"
            >
              <Upload size={14} /> Import
            </button>
            <input ref={fileRef} type="file" accept="application/json" onChange={handleImportFile} hidden />
          </div>

          <button
            onClick={() => {
              if (confirm('Reset your whole tree? This cannot be undone (export a backup first).')) {
                resetAll()
                onClose()
              }
            }}
            className="w-full rounded-lg border border-rose-400/25 text-rose-300 hover:bg-rose-500/10 py-2"
          >
            Reset tree
          </button>
        </div>
      </motion.div>
    </div>
  )
}
