import { deriveKey, encryptJson, decryptJson } from './crypto'
import { validateEvent } from './events'

// Pushes local events as ciphertext and pulls new ones from the relay.
// `transport` is injected so tests can run two devices against one fake relay.
export function createSync({ log, transport, iterations }) {
  let vault = null
  let running = false

  return {
    async configure(passphrase) {
      vault = passphrase ? await deriveKey(passphrase, 'evergrove-sync-v1', iterations) : null
      return vault?.vaultId ?? null
    },

    enabled() {
      return !!vault
    },

    async syncNow() {
      if (!vault) return { pushed: 0, pulled: 0, skipped: 'sync is off' }
      if (running) return { pushed: 0, pulled: 0, skipped: 'already syncing' }
      running = true
      try {
        const store = log.store
        let pushed = 0
        for (;;) {
          const batch = await store.unpushed(50)
          if (!batch.length) break
          const items = []
          for (const e of batch) {
            const { iv, ct } = await encryptJson(vault.key, e)
            items.push({ id: e.id, iv, ct })
          }
          await transport.push(vault.vaultId, items)
          await store.markPushed(batch.map((e) => e.id))
          pushed += batch.length
        }

        let cursor = (await store.getMeta('syncCursor')) ?? 0
        let pulled = 0
        let failed = 0
        for (;;) {
          const { items, next } = await transport.pull(vault.vaultId, cursor)
          if (!items.length) break
          const good = []
          for (const item of items) {
            try {
              const event = await decryptJson(vault.key, item)
              if (validateEvent(event)) {
                failed += 1
                continue
              }
              good.push(event)
            } catch {
              failed += 1
            }
          }
          if (!good.length) {
            // Nothing decrypted: almost certainly the wrong passphrase. Keep the
            // cursor where it is so a corrected passphrase re-reads these items.
            throw new Error('Could not decrypt synced data. Is the passphrase the same on both devices?')
          }
          if (good.length) {
            const added = await log.append(good, { remote: true })
            pulled += added.length
            await store.markPushed(good.map((e) => e.id))
          }
          cursor = next
          await store.setMeta('syncCursor', cursor)
        }

        return { pushed, pulled, failed }
      } finally {
        running = false
      }
    },
  }
}

// baseUrl defaults to a same-origin relative path (Evergrove's own use). A second app on its
// own domain (MOXIE) passes Evergrove's absolute origin instead, so this same relay can hold a
// second, independently encrypted copy of the log. See api/sync.js's CORS allowlist.
export function httpTransport(getAccessCode, fetchImpl = fetch, baseUrl = '/api/sync') {
  const headers = () => ({ 'Content-Type': 'application/json', 'x-app-code': getAccessCode() })
  return {
    async push(vaultId, items) {
      const res = await fetchImpl(baseUrl, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ vaultId, items }),
      })
      if (!res.ok) throw new Error(`Sync push failed (${res.status})`)
    },
    async pull(vaultId, after) {
      const res = await fetchImpl(`${baseUrl}?vaultId=${vaultId}&after=${after}`, { headers: headers() })
      if (!res.ok) throw new Error(`Sync pull failed (${res.status})`)
      return res.json()
    },
  }
}
