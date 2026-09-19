import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { getRuntime } from './runtime'
import { loadSettings, saveSettings, defaultSettings } from './settings'
import { deriveEvergrove } from '../evergrove/derive'
import { deriveInsights } from '../evergrove/insights'
import { createEvent, newId } from '../core/events'
import { legacyToEvents } from '../evergrove/migrate'
import { levelFromXp, slugify } from '../lib/treeEngine'
import { getAccessCode } from '../lib/storage'
import { disablePushReminders } from '../lib/push'

const Ctx = createContext(null)
export const useApp = () => useContext(Ctx)

const NO_EVENTS = []

export function AppProvider({ children }) {
  const [runtime, setRuntime] = useState(null)
  const [bootError, setBootError] = useState(null)
  const [settings, setSettingsState] = useState(loadSettings)
  const [pending, setPending] = useState(false)
  const [lastResult, setLastResult] = useState(null)
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
      treeName: settings.treeName,
      skills: evState.skills,
      entries: evState.entries,
      settings: {
        reminderEnabled: settings.reminderEnabled,
        reminderTime: settings.reminderTime,
        onboarded: settings.onboarded,
      },
    }),
    [settings, evState]
  )

  const run = useCallback(
    (name, args, opts = {}) => runtime.registry.invoke(name, args, { actor: 'user', approved: true, ...opts }),
    [runtime]
  )

  const addEntry = useCallback(
    async (text) => {
      const trimmed = text.trim()
      if (!trimmed || !runtime) return null
      setPending(true)
      setLastResult(null)
      try {
        const existing = {}
        for (const [area, skills] of Object.entries(evState.skills)) {
          existing[area] = Object.values(skills).map((s) => ({ id: s.id, name: s.name }))
        }
        const res = await fetch('/api/parse-entry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-app-code': getAccessCode() },
          body: JSON.stringify({ text: trimmed, existingSkills: existing }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || `Request failed (${res.status})`)
        }
        const data = await res.json()
        const updates = Array.isArray(data.updates) ? data.updates : []
        const before = deriveEvergrove(runtime.log.getEvents())
        const correlationId = newId()
        const evs = updates.map((u) =>
          createEvent({
            type: 'skill.practiced',
            app: 'evergrove',
            area: u.domain,
            correlationId,
            data: {
              domain: u.domain,
              skillId: slugify(u.skillId || u.skillName),
              skillName: u.skillName,
              xp: u.xpGain,
              text: trimmed,
              summary: data.summary || '',
            },
          })
        )
        if (evs.length) await runtime.log.append(evs)
        const after = deriveEvergrove(runtime.log.getEvents())
        const levelUps = []
        for (const u of updates) {
          const id = slugify(u.skillId || u.skillName)
          const b = levelFromXp(before.skills[u.domain]?.[id]?.xp ?? 0).level
          const a = levelFromXp(after.skills[u.domain]?.[id]?.xp ?? 0).level
          if (a > b) levelUps.push({ skillName: u.skillName, level: a })
        }
        const result = { summary: data.summary, updates, levelUps }
        setLastResult(result)
        return result
      } catch (err) {
        setLastResult({ error: err.message || 'Something went wrong logging that.' })
        return null
      } finally {
        setPending(false)
      }
    },
    [runtime, evState]
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
    run,
    reverseEvent,
    addEntry,
    pending,
    lastResult,
    syncStatus,
    syncNow: () => runtime?.syncNow(),
    setSyncPassphrase,
    exportBackup,
    importBackup,
    resetAll,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
