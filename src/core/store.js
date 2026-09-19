// IndexedDB-backed append-only event store. There is deliberately no update
// or single-event delete: history only grows. `clearAll` exists solely for the
// explicit "reset everything" action.

const DB_VERSION = 1

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export async function openStore(name = 'evergrove-log') {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      d.createObjectStore('events', { keyPath: 'id' })
      d.createObjectStore('meta', { keyPath: 'key' })
      d.createObjectStore('pushed', { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

  return {
    // Returns the events that were actually new (duplicates are skipped).
    async appendMany(input) {
      const events = [...new Map(input.map((e) => [e.id, e])).values()]
      const added = []
      const tx = db.transaction('events', 'readwrite')
      const os = tx.objectStore('events')
      await Promise.all(
        events.map(async (e) => {
          const existing = await promisify(os.get(e.id))
          if (existing) return
          os.add(e)
          added.push(e)
        })
      )
      await txDone(tx)
      return added
    },

    async all() {
      return promisify(db.transaction('events').objectStore('events').getAll())
    },

    async count() {
      return promisify(db.transaction('events').objectStore('events').count())
    },

    async getMeta(key) {
      const row = await promisify(db.transaction('meta').objectStore('meta').get(key))
      return row ? row.value : undefined
    },

    async setMeta(key, value) {
      const tx = db.transaction('meta', 'readwrite')
      tx.objectStore('meta').put({ key, value })
      await txDone(tx)
    },

    async markPushed(ids) {
      const tx = db.transaction('pushed', 'readwrite')
      for (const id of ids) tx.objectStore('pushed').put({ id })
      await txDone(tx)
    },

    async unpushed(limit = 100) {
      const [events, pushed] = await Promise.all([
        promisify(db.transaction('events').objectStore('events').getAll()),
        promisify(db.transaction('pushed').objectStore('pushed').getAllKeys()),
      ])
      const done = new Set(pushed)
      return events.filter((e) => !done.has(e.id)).slice(0, limit)
    },

    async clearAll() {
      const tx = db.transaction(['events', 'meta', 'pushed'], 'readwrite')
      tx.objectStore('events').clear()
      tx.objectStore('meta').clear()
      tx.objectStore('pushed').clear()
      await txDone(tx)
    },

    close() {
      db.close()
    },
  }
}
