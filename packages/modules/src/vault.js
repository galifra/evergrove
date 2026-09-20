import { createEvent, effectiveEvents, localDate } from '@evergrove/core/events.js'
import { deriveKey, encryptJson, decryptJson } from '@evergrove/core/crypto.js'

// The vault holds IDs, legal records, emergency contacts and plans. Items are
// encrypted with a separate passphrase that lives only in memory while unlocked
// and is never sent anywhere. Jarvis has no actions here and gets no context.

export const VAULT_KINDS = ['identity', 'legal', 'emergency contact', 'contingency plan', 'digital security', 'other']

// A short, practical digital-security checklist. Ticking an item is a claim
// the user makes about themselves: nothing is inspected or verified for them.
export const SECURITY_CHECKLIST = [
  { id: 'password-manager', title: 'Use a password manager', why: 'Unique passwords everywhere are only realistic if something remembers them.' },
  { id: 'unique-passwords', title: 'No password is reused on important accounts', why: 'One leaked site should never open your email or bank.' },
  { id: 'email-2fa', title: 'Two-step sign-in on your main email', why: 'Email resets every other account, so protect it first.' },
  { id: 'finance-2fa', title: 'Two-step sign-in on banking and money accounts', why: 'Stops a stolen password from being enough.' },
  { id: 'recovery-codes', title: 'Recovery codes saved somewhere offline', why: 'Lets you back in if you lose your phone.' },
  { id: 'device-lock', title: 'Phone and computer lock automatically', why: 'A lost device should not be an open door.' },
  { id: 'updates', title: 'Devices and apps update automatically', why: 'Most attacks use flaws that already have a fix.' },
  { id: 'backups', title: 'Important files are backed up, and a restore was tried', why: 'A backup you have never restored is a hope, not a backup.' },
  { id: 'phishing', title: 'You check the sender before clicking a link about money or accounts', why: 'Most account takeovers begin with a convincing message.' },
  { id: 'emergency-sheet', title: 'Someone you trust knows where your emergency sheet is', why: 'So the important things can be found if you cannot help.' },
]
export const SECURITY_REVIEW_DAYS = 180

export function securityEvent(itemId, checked, now = new Date()) {
  return createEvent({ type: 'security.checked', app: 'vault', area: 'discipline', now, data: { itemId, checked: !!checked, date: localDate(now) } })
}

export function deriveVault(events, now = new Date()) {
  const items = new Map()
  const security = new Map()
  for (const e of effectiveEvents(events)) {
    const d = e.data
    if (e.type === 'security.checked') {
      if (SECURITY_CHECKLIST.some((c) => c.id === d.itemId)) security.set(d.itemId, { checked: !!d.checked, date: d.date })
    } else if (e.type === 'vault.item.saved') {
      items.set(d.itemId, { id: d.itemId, title: d.title, kind: d.kind, iv: d.iv, ct: d.ct, savedAt: e.occurredAt })
    } else if (e.type === 'vault.item.deleted') {
      items.delete(d.itemId)
    }
  }
  const today = localDate(now)
  const checklist = SECURITY_CHECKLIST.map((c) => {
    const s = security.get(c.id)
    const done = !!s?.checked
    const ageDays = done ? Math.round((new Date(`${today}T00:00`) - new Date(`${s.date}T00:00`)) / 86400000) : null
    return { ...c, done, checkedOn: done ? s.date : null, stale: done && ageDays > SECURITY_REVIEW_DAYS }
  })
  return {
    items: [...items.values()].sort((a, b) => a.title.localeCompare(b.title)),
    checklist,
    checklistDone: checklist.filter((c) => c.done).length,
    checklistStale: checklist.filter((c) => c.stale).length,
  }
}

const SHEET_KINDS = ['emergency contact', 'contingency plan']

// The text of an emergency sheet, built from items the user has just
// decrypted. It never takes the vault passphrase: only a note about where that
// is kept, written by the user. The result is NOT encrypted; the caller shows a
// warning and never stores it.
export function buildEmergencySheet({ items, treeName = 'Evergrove', generatedOn, passphraseNote = '', kinds = SHEET_KINDS }) {
  const chosen = items.filter((i) => kinds.includes(i.kind))
  const lines = [
    'EMERGENCY SHEET',
    `Made on ${generatedOn} from ${treeName}`,
    '',
    'This page is not encrypted. Keep it somewhere private and physical, such as a safe or a sealed envelope, and give it only to someone you trust.',
    '',
  ]
  if (passphraseNote.trim()) lines.push('WHERE THE VAULT PASSPHRASE IS KEPT', passphraseNote.trim(), '')
  for (const kind of kinds) {
    const group = chosen.filter((i) => i.kind === kind)
    if (!group.length) continue
    lines.push(kind.toUpperCase() + (group.length === 1 ? '' : 'S'), '-'.repeat(kind.length + (group.length === 1 ? 0 : 1)))
    for (const it of group) lines.push(it.title, it.body.trim(), '')
  }
  if (!chosen.length) lines.push('No emergency contacts or contingency plans are saved in the vault yet.', '')
  lines.push('HOW TO OPEN THE VAULT', 'Open Evergrove, go to the Vault page, and enter the vault passphrase. It is separate from the sync passphrase and cannot be recovered if lost.')
  return lines.join('\n')
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
