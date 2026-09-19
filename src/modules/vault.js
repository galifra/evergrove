import { effectiveEvents } from '../core/events'
import { deriveKey, encryptJson, decryptJson } from '../core/crypto'

// The vault holds IDs, legal records, emergency contacts and plans. Items are
// encrypted with a separate passphrase that lives only in memory while unlocked
// and is never sent anywhere. Jarvis has no actions here and gets no context.

export const VAULT_KINDS = ['identity', 'legal', 'emergency contact', 'contingency plan', 'digital security', 'other']

export function deriveVault(events) {
  const items = new Map()
  for (const e of effectiveEvents(events)) {
    const d = e.data
    if (e.type === 'vault.item.saved') {
      items.set(d.itemId, { id: d.itemId, title: d.title, kind: d.kind, iv: d.iv, ct: d.ct, savedAt: e.occurredAt })
    } else if (e.type === 'vault.item.deleted') {
      items.delete(d.itemId)
    }
  }
  return { items: [...items.values()].sort((a, b) => a.title.localeCompare(b.title)) }
}

export async function unlockVault(passphrase, iterations) {
  const { key } = await deriveKey(passphrase, 'evergrove-vault-v1', iterations)
  return key
}

export async function sealItem(key, { title, kind, body }) {
  const { iv, ct } = await encryptJson(key, { body })
  return { itemId: `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, title, kind, iv, ct }
}

export async function openItem(key, item) {
  return (await decryptJson(key, item)).body
}

export const vaultModule = {
  id: 'vault',
  name: 'Vault',
  icon: 'lock',
  area: 'inner',
  description: 'Encrypted IDs, legal records, emergency contacts and contingency plans.',
  sensitive: true,
  derive: deriveVault,
  actions: [],
}
