import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { getRuntime } from './runtime'
import { loadSettings, saveSettings, defaultSettings } from './settings'
import { deriveEvergrove } from '@evergrove/rules/derive.js'
import { deriveInsights } from '@evergrove/rules/insights.js'
import { createEvent } from '@evergrove/core/events.js'
import { legacyToEvents } from '@evergrove/rules/migrate.js'
import { disablePushReminders } from './lib/push'

const Ctx = createContext(null)
export const useApp = () => useContext(Ctx)

const NO_EVENTS = []

export function AppProvider({ children }) {
  const [runtime, setRuntime] = useState(null)
  const [bootError, setBootError] = useState(null)
  const [settings, setSettingsState] = useState(loadSettings)
  const [syncStatus, setSyncStatus] = useState({ state: 'off', message: '' })

  useEffect(() => {
    let alive = true
    getRuntime()
      .then((rt) => alive && setRuntime(rt))
      .catch((err) => alive && setBootError(err))
    return () => {
      alive = false
    }
  }, [])

  const subscribe = useCallback((fn) => (runtime ? runtime.log.subscribe(fn) : () => {}), [runtime])
  const events = useSyncExternalStore(subscribe, () => (runtime ? runtime.log.getEvents() : NO_EVENTS))

  useEffect(() => {
    if (!runtime) return undefined
    const off = runtime.onSyncStatus(setSyncStatus)
    if (settings.syncPassphrase) runtime.configureSync(settings.syncPassphrase)
    return off
    // configure once per runtime; changing the passphrase goes through setSyncPassphrase
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime])

  // The service worker builds the evening briefing from the device's own data
  // and cannot see localStorage, so the two privacy choices live in the database too.
  useEffect(() => {
    if (!runtime) return
    runtime.store.setMeta('briefingPrefs', { detail: settings.briefingDetail, showAmounts: settings.showAmounts, speakUp: settings.speakUp })
  }, [runtime, settings.briefingDetail, settings.showAmounts, settings.speakUp])

  // The service worker keeps the app itself available offline, whether or not
  // reminders are on (push stays opt-in and is set up separately). Registering
  // again on each start also checks for a newer version. Skipped in dev so
  // hot reload is never served from a cache.
  useEffect(() => {
    if (runtime && import.meta.env.PROD && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
  }, [runtime])

  const evState = useMemo(() => deriveEvergrove(events), [events])
  const insights = useMemo(() => deriveInsights(evState), [evState])

  const updateSettings = useCallback((patch) => {
    setSettingsState((s) => {
      const next = { ...s, ...patch }
      saveSettings(next)
      return next
    })
  }, [])

  // The shape the existing tree UI already understands.
  const viewState = useMemo(
    () => ({
      treeName: evState.treeName ?? settings.treeName,
      skills: evState.skills,
      entries: evState.entries,
      paused: evState.paused,
      settings: {
        reminderEnabled: settings.reminderEnabled,
        reminderTime: settings.reminderTime,
        onboarded: settings.onboarded,
      },
    }),
    [settings, evState]
  )

  const renameTree = useCallback(
    (name) => {
      const next = name.trim().slice(0, 40) || 'My Grove'
      updateSettings({ treeName: next })
      if (runtime && next !== (evState.treeName ?? settings.treeName)) {
        runtime.log.append(createEvent({ type: 'tree.named', app: 'evergrove', actor: 'user', data: { name: next } }))
      }
    },
    [runtime, evState.treeName, settings.treeName, updateSettings]
  )

  const run = useCallback(
    (name, args, opts = {}) => runtime.registry.invoke(name, args, { actor: 'user', approved: true, ...opts }),
    [runtime]
  )

  const reverseEvent = useCallback(
    (id) =>
      runtime.log.append(createEvent({ type: 'event.reversed', app: 'evergrove', supersedes: id, actor: 'user', data: { reason: 'undo' } })),
    [runtime]
  )

  const setSyncPassphrase = useCallback(
    async (passphrase) => {
      updateSettings({ syncPassphrase: passphrase })
      await runtime.configureSync(passphrase)
    },
    [runtime, updateSettings]
  )

  const exportBackup = useCallback(() => {
    const payload = { format: 'evergrove-backup', version: 2, exportedAt: new Date().toISOString(), settings: { ...settings, syncPassphrase: '' }, events }
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `evergrove-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [settings, events])

  const importBackup = useCallback(
    async (parsed) => {
      if (Array.isArray(parsed?.events)) return runtime.importEvents(parsed.events)
      if (parsed?.skills || parsed?.entries) return runtime.importEvents(legacyToEvents(parsed))
      throw new Error('That file is not an Evergrove backup.')
    },
    [runtime]
  )

  const resetAll = useCallback(async () => {
    await disablePushReminders().catch(() => {})
    await runtime.resetAll()
    const fresh = { ...defaultSettings() }
    saveSettings(fresh)
    setSettingsState(fresh)
  }, [runtime])

  const value = {
    ready: !!runtime,
    bootError,
    runtime,
    events,
    evState,
    insights,
    viewState,
    settings,
    updateSettings,
    renameTree,
    run,
    reverseEvent,
    syncStatus,
    syncNow: () => runtime?.syncNow(),
    setSyncPassphrase,
    exportBackup,
    importBackup,
    resetAll,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
