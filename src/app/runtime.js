import { openStore } from '../core/store'
import { createLog } from '../core/log'
import { createSync, httpTransport } from '../core/sync'
import { validateEvent } from '../core/events'
import { createAppRegistry, runMaintenance } from '../modules'
import { legacyToEvents } from '../evergrove/migrate'
import { getAccessCode } from '../lib/storage'
import { loadLegacyTree } from './settings'

// One runtime per page: the store, the log, the app registry and sync. Nothing
// here polls. Sync runs on open, when you return to the tab, and shortly after
// you save something.
let runtimePromise = null

export function getRuntime() {
  runtimePromise ??= createRuntime()
  return runtimePromise
}

async function createRuntime() {
  const store = await openStore()
  const log = createLog(store)
  await log.load()

  // One-time move of the old localStorage tree into the log. The old key is
  // left untouched as a rollback copy.
  const legacy = loadLegacyTree()
  if (legacy && !(await store.getMeta('legacyMigrated'))) {
    await log.append(legacyToEvents(legacy), { remote: true })
    await store.setMeta('legacyMigrated', true)
  }

  const registry = createAppRegistry(log)
  const sync = createSync({ log, transport: httpTransport(getAccessCode) })

  let syncTimer = null
  const syncListeners = new Set()
  const status = { state: 'off', message: '', lastAt: null }
  const setStatus = (patch) => {
    Object.assign(status, patch)
    for (const fn of syncListeners) fn({ ...status })
  }

  async function syncNow() {
    if (!sync.enabled()) return setStatus({ state: 'off', message: '' })
    setStatus({ state: 'syncing', message: '' })
    try {
      const r = await sync.syncNow()
      setStatus({ state: 'ok', message: `Sent ${r.pushed}, received ${r.pulled}`, lastAt: new Date().toISOString() })
    } catch (err) {
      const message = err.message.includes('(401)') ? 'Access code missing or wrong (401)' : err.message
      setStatus({ state: 'error', message })
    }
  }

  function scheduleSync() {
    if (!sync.enabled()) return
    clearTimeout(syncTimer)
    syncTimer = setTimeout(syncNow, 2000)
  }

  // Every local write schedules a sync. Events that arrive from sync (`remote`) don't.
  const rawAppend = log.append.bind(log)
  log.append = async (input, opts = {}) => {
    const added = await rawAppend(input, opts)
    if (added.length && !opts.remote) {
      scheduleSync()
    }
    return added
  }

  await runMaintenance(log)

  window.addEventListener('evergrove-code-changed', syncNow)

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncNow()
  })

  return {
    store,
    log,
    registry,
    sync,
    syncNow,
    onSyncStatus(fn) {
      syncListeners.add(fn)
      fn({ ...status })
      return () => syncListeners.delete(fn)
    },
    async configureSync(passphrase) {
      const id = await sync.configure(passphrase)
      if (!passphrase) setStatus({ state: 'off', message: '' })
      else await syncNow()
      return id
    },
    async importEvents(events) {
      const valid = events.filter((e) => !validateEvent(e))
      const added = await log.append(valid, { remote: true })
      return { total: events.length, valid: valid.length, added: added.length }
    },
    async resetAll() {
      await log.reset()
      await store.setMeta('legacyMigrated', true)
      await sync.configure('')
      setStatus({ state: 'off', message: '' })
    },
  }
}
