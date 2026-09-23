import { useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Download, RefreshCw, Upload, X } from 'lucide-react'
import { useApp } from '../AppContext'
import { getAccessCode, setAccessCode } from '@evergrove/core/lib/storage.js'
import { pushSupported, enablePushReminders, disablePushReminders, showBriefingPreview } from '../lib/push'
import { composeBriefing } from '@evergrove/rules/briefing.js'
import AiBudget from './AiBudget.jsx'
import { describeVerification, verifyLog } from '@evergrove/rules/verify.js'
import { listApps } from '@evergrove/rules/registry.js'
import { AccessCodePrompt } from '@evergrove/ui/components/ui.jsx'
import { useDialog } from '@evergrove/ui/components/useDialog.js'

const section = 'rounded-xl border border-white/10 p-3'
const input =
  'w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 focus:outline-none focus:border-emerald-400/50 placeholder:text-white/25'

export default function SettingsModal({ onClose }) {
  const app = useApp()
  const dialogRef = useDialog(true, onClose)
  const { settings, updateSettings, events, syncStatus } = app
  const [name, setName] = useState(settings.treeName)
  const [code, setCode] = useState(getAccessCode())
  const [codeSaved, setCodeSaved] = useState(!!getAccessCode())
  const [reminderError, setReminderError] = useState('')
  const [reminderBusy, setReminderBusy] = useState(false)
  const [pass, setPass] = useState(settings.syncPassphrase)
  const [notice, setNotice] = useState('')
  const [health, setHealth] = useState('')
  const fileRef = useRef(null)

  const sensitiveApps = useMemo(() => listApps(events).filter((a) => a.sensitive && a.id !== 'vault'), [events])

  async function handleReminderToggle(checked) {
    setReminderError('')
    setReminderBusy(true)
    try {
      if (checked) {
        await enablePushReminders(settings.reminderTime)
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

  async function handleReminderTime(value) {
    updateSettings({ reminderTime: value })
    if (settings.reminderEnabled) await enablePushReminders(value).catch(() => {})
  }

  async function previewBriefing() {
    setReminderError('')
    try {
      await showBriefingPreview(composeBriefing(events, new Date(), { detail: settings.briefingDetail, showAmounts: settings.showAmounts, speakUp: settings.speakUp }))
    } catch (err) {
      setReminderError(err.message)
    }
  }

  function toggleShare(id, on) {
    const set = new Set(settings.shareSensitive)
    if (on) set.add(id)
    else set.delete(id)
    updateSettings({ shareSensitive: [...set] })
  }

  function handleImportFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const r = await app.importBackup(JSON.parse(reader.result))
        setNotice(`Imported ${r.added} new event${r.added === 1 ? '' : 's'} (${r.total - r.valid} skipped as invalid).`)
      } catch (err) {
        setNotice(err.message || 'Could not read that file.')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4">
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        tabIndex={-1}
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0e1a13] p-5 shadow-2xl"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id="settings-title" className="font-display text-xl">Settings</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 text-sm">
          <label className="block">
            <span className="text-white/60 text-xs">Tree name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => app.renameTree(name)}
              className={`mt-1 ${input}`}
            />
          </label>

          <div className={section}>
            <div className="flex items-center justify-between">
              <span className="text-white/80">Daily reminder</span>
              <input
                type="checkbox"
                checked={settings.reminderEnabled}
                disabled={reminderBusy}
                onChange={(e) => handleReminderToggle(e.target.checked)}
                className="w-4 h-4 accent-emerald-500"
              />
            </div>
            {!pushSupported() && <p className="text-xs text-amber-300/80 mt-1">This browser doesn't support push notifications.</p>}
            {reminderError && <p className="text-xs text-rose-300 mt-1">{reminderError}</p>}
            <p className="text-xs text-white/55 mt-1">Every evening at this time, a real notification tells you what tomorrow holds, even if Evergrove isn't open. It's built on this device from your own data; the server only sends a wake-up.</p>
            <input
              type="time"
              value={settings.reminderTime}
              onChange={(e) => handleReminderTime(e.target.value)}
              className="mt-2 rounded-lg bg-white/5 border border-white/10 px-3 py-1.5"
            />
            <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
              <label className="flex items-center justify-between gap-3">
                <span className="text-white/70 text-xs">What it shows on your lock screen</span>
                <select
                  value={settings.briefingDetail}
                  onChange={(e) => updateSettings({ briefingDetail: e.target.value })}
                  className="rounded-lg bg-white/5 border border-white/10 px-2 py-1 text-xs"
                >
                  <option value="full" className="bg-[#0e1a13]">Names and times</option>
                  <option value="counts" className="bg-[#0e1a13]">Counts only</option>
                </select>
              </label>
              {settings.briefingDetail === 'full' && (
                <label className="flex items-center justify-between gap-3">
                  <span className="text-white/70 text-xs">Include bill amounts</span>
                  <input
                    type="checkbox"
                    checked={settings.showAmounts}
                    onChange={(e) => updateSettings({ showAmounts: e.target.checked })}
                    className="w-4 h-4 accent-emerald-500"
                  />
                </label>
              )}
              <button onClick={previewBriefing} className="text-xs underline text-white/60 hover:text-white/90">
                Show me tonight's notification now
              </button>
            </div>
          </div>

          <div className={section}>
            <div className="flex items-center justify-between">
              <span className="text-white/80">Sync between devices</span>
              <span className="text-xs text-white/55">
                {syncStatus.state === 'off' && 'Off'}
                {syncStatus.state === 'syncing' && 'Syncing...'}
                {syncStatus.state === 'ok' && syncStatus.message}
                {syncStatus.state === 'error' && <span className="text-rose-300">Problem</span>}
              </span>
            </div>
            <p className="text-xs text-white/55 mt-1">
              Use the same passphrase on each device. Your data is encrypted on the device before it leaves; the server only stores scrambled data. Nothing runs in the background: it syncs when you open the app, return to it, or save something.
            </p>
            <div className="mt-2 flex gap-2">
              <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Sync passphrase" className={input} autoComplete="off" />
              <button
                onClick={() => app.setSyncPassphrase(pass.trim())}
                className="px-3 rounded-lg bg-emerald-500 text-emerald-950 shrink-0"
              >
                {settings.syncPassphrase && pass === settings.syncPassphrase ? 'Saved' : pass.trim() ? 'Turn on' : 'Turn off'}
              </button>
              {settings.syncPassphrase && (
                <button onClick={app.syncNow} className="px-2.5 rounded-lg bg-white/5 border border-white/10" aria-label="Sync now">
                  <RefreshCw size={14} />
                </button>
              )}
            </div>
            {syncStatus.state === 'error' && <p className="text-xs text-rose-300 mt-2">{syncStatus.message}</p>}
            {syncStatus.state === 'error' && /401/.test(syncStatus.message) && (
              <div>
                <p className="text-xs text-white/50 mt-1">The server needs your access code first.</p>
                <AccessCodePrompt onSaved={app.syncNow} />
              </div>
            )}
          </div>

          <div className={section}>
            <span className="text-white/80">AI budget</span>
            <p className="text-xs text-white/55 mt-1 mb-2">A hard monthly cap shared by everything here. When it is reached the AI stops until next month; everything else keeps working.</p>
            <AiBudget />
          </div>

          <div className={section}>
            <span className="text-white/80">Share private areas with MOXIE</span>
            <p className="text-xs text-white/55 mt-1">
              Off by default. MOXIE can still log to these when you tell it something, but it won't see summaries of what's inside unless you turn a switch on. The vault is never shared.
            </p>
            <div className="mt-2 space-y-1.5">
              {sensitiveApps.map((a) => (
                <label key={a.id} className="flex items-center justify-between">
                  <span className="text-white/70">{a.name}</span>
                  <input
                    type="checkbox"
                    checked={settings.shareSensitive.includes(a.id)}
                    onChange={(e) => toggleShare(a.id, e.target.checked)}
                    className="w-4 h-4 accent-emerald-500"
                  />
                </label>
              ))}
            </div>
          </div>

          <div>
            <span className="text-white/60 text-xs">App access code</span>
            <div className="mt-1 flex gap-2">
              <input
                value={code}
                onChange={(e) => {
                  setCode(e.target.value)
                  setCodeSaved(false)
                }}
                placeholder="only needed if the server has APP_ACCESS_CODE set"
                autoComplete="off"
                className={input}
              />
              <button
                onClick={() => {
                  setAccessCode(code.trim())
                  setCodeSaved(true)
                }}
                className="px-3 rounded-lg bg-emerald-500 text-emerald-950 shrink-0"
              >
                {codeSaved ? 'Saved' : 'Save'}
              </button>
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={app.exportBackup} className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 py-2">
              <Download size={14} /> Export
            </button>
            <button onClick={() => fileRef.current?.click()} className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 py-2">
              <Upload size={14} /> Import
            </button>
            <input ref={fileRef} type="file" accept="application/json" onChange={handleImportFile} hidden />
          </div>
          <p className="text-xs text-white/55 -mt-2">An export holds everything in plain text (Vault items stay encrypted). Keep the file somewhere private.</p>
          {notice && <p className="text-xs text-white/60" role="status">{notice}</p>}

          <div>
            <button
              onClick={() => setHealth(describeVerification(verifyLog(events)))}
              className="text-xs underline text-white/60 hover:text-white/90"
            >
              Check my data
            </button>
            {health && <p className="mt-1 text-xs text-white/60" role="status">{health}</p>}
          </div>

          <button
            onClick={async () => {
              if (confirm('Erase everything on this device? Export a backup first. If sync is on, the synced copy stays on the server; turn sync off or use a new passphrase afterward.')) {
                await app.resetAll()
                onClose()
              }
            }}
            className="w-full rounded-lg border border-rose-400/25 text-rose-300 hover:bg-rose-500/10 py-2"
          >
            Reset this device
          </button>
        </div>
      </motion.div>
    </div>
  )
}
