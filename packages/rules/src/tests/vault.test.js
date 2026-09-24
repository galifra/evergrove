import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { openStore } from '@evergrove/core/store.js'
import { createLog } from '@evergrove/core/log.js'
import { createEvent, validateEvent } from '@evergrove/core/events.js'
import { buildEmergencySheet, deriveVault, openItem, sealItem, securityEvent, SECURITY_CHECKLIST, unlockVault } from '@evergrove/modules/vault.js'
import { deriveEvergrove } from '../derive'

const NOW = new Date(2026, 4, 15, 12)
const PASS = 'correct horse battery staple'
let log

beforeEach(async () => {
  log = createLog(await openStore(`vt-${Math.random()}`), { channelName: `vtc-${Math.random()}` })
})

async function save(key, item) {
  const sealed = await sealItem(key, item)
  await log.append(createEvent({ type: 'vault.item.saved', app: 'vault', data: sealed }))
  return sealed
}

describe('vault restore drill (T8)', () => {
  it('a backup restored onto a brand-new device opens with the passphrase and only with it', async () => {
    const key = await unlockVault(PASS, 1000)
    await save(key, { title: 'Passport', kind: 'identity', body: 'A1234567-SECRET' })
    await save(key, { title: 'Sam (sister)', kind: 'emergency contact', body: '555-0142 SECRET-PHONE' })

    // Same steps the export button and import perform.
    const backup = JSON.parse(JSON.stringify({ format: 'evergrove-backup', version: 2, events: log.getEvents() }))
    const json = JSON.stringify(backup)
    expect(json).not.toContain('A1234567-SECRET')
    expect(json).not.toContain('SECRET-PHONE')
    expect(json).not.toContain(PASS)

    const device2 = createLog(await openStore(`vt2-${Math.random()}`), { channelName: `vtc2-${Math.random()}` })
    const valid = backup.events.filter((e) => !validateEvent(e))
    expect(valid).toHaveLength(backup.events.length)
    await device2.append(valid, { remote: true })

    const restored = deriveVault(device2.getEvents()).items
    expect(restored.map((i) => i.title)).toEqual(['Passport', 'Sam (sister)'])
    const key2 = await unlockVault(PASS, 1000)
    expect(await openItem(key2, restored[0])).toBe('A1234567-SECRET')
    expect(await openItem(key2, restored[1])).toBe('555-0142 SECRET-PHONE')

    const wrong = await unlockVault('a different passphrase', 1000)
    for (const it of restored) await expect(openItem(wrong, it)).rejects.toThrow()
  })

  it('importing the same backup twice changes nothing', async () => {
    const key = await unlockVault(PASS, 1000)
    await save(key, { title: 'Will', kind: 'legal', body: 'in the safe' })
    const backup = JSON.parse(JSON.stringify({ events: log.getEvents() }))
    const device2 = createLog(await openStore(`vt3-${Math.random()}`), { channelName: `vtc3-${Math.random()}` })
    await device2.append(backup.events, { remote: true })
    const again = await device2.append(backup.events, { remote: true })
    expect(again).toHaveLength(0)
    expect(deriveVault(device2.getEvents()).items).toHaveLength(1)
  })
})

describe('emergency sheet', () => {
  const items = [
    { title: 'Sam (sister)', kind: 'emergency contact', body: '555-0142\n  Knows my accounts  ' },
    { title: 'Dr. Ortiz', kind: 'emergency contact', body: '555-0177' },
    { title: 'If I am in hospital', kind: 'contingency plan', body: 'Feed the cat. Call work.' },
    { title: 'Passport', kind: 'identity', body: 'A1234567' },
  ]

  it('includes emergency contacts and plans, leaves everything else out', () => {
    const t = buildEmergencySheet({ items, generatedOn: '2026-05-15', treeName: 'Evergrove' })
    expect(t).toMatch(/^EMERGENCY SHEET\nMade on 2026-05-15 from Evergrove/)
    expect(t).toContain('EMERGENCY CONTACTS')
    expect(t).toContain('Sam (sister)\n555-0142\n  Knows my accounts')
    expect(t).toContain('CONTINGENCY PLAN\n')
    expect(t).toContain('Feed the cat')
    expect(t).not.toContain('Passport')
    expect(t).not.toContain('A1234567')
  })

  it('carries a note about where the passphrase is kept but can never contain the passphrase itself', () => {
    const t = buildEmergencySheet({ items, generatedOn: '2026-05-15', passphraseNote: 'Sealed envelope in the hall safe' })
    expect(t).toContain('WHERE THE VAULT PASSPHRASE IS KEPT\nSealed envelope in the hall safe')
    expect(buildEmergencySheet.length).toBe(1) // one options object: there is no passphrase parameter
    expect(t).toMatch(/not encrypted/)
    expect(t).toMatch(/cannot be recovered/)
  })

  it('says so plainly when nothing is saved yet', () => {
    expect(buildEmergencySheet({ items: [], generatedOn: '2026-05-15' })).toMatch(/No emergency contacts or contingency plans are saved/)
  })
})

describe('digital security checklist', () => {
  it('starts unticked, remembers the latest choice, and ignores made-up items', async () => {
    expect(deriveVault([], NOW)).toMatchObject({ checklistDone: 0, checklistStale: 0 })
    await log.append(securityEvent('email-2fa', true, NOW))
    await log.append(securityEvent('backups', true, NOW))
    await log.append(securityEvent('backups', false, new Date(NOW.getTime() + 5000)))
    await log.append(createEvent({ type: 'security.checked', app: 'vault', data: { itemId: 'not-a-real-item', checked: true, date: '2026-05-15' } }))
    const v = deriveVault(log.getEvents(), NOW)
    expect(v.checklistDone).toBe(1)
    expect(v.checklist.find((c) => c.id === 'email-2fa')).toMatchObject({ done: true, checkedOn: '2026-05-15', stale: false })
    expect(v.checklist).toHaveLength(SECURITY_CHECKLIST.length)
  })

  it('flags an item as worth a fresh look after six months', async () => {
    await log.append(securityEvent('updates', true, new Date(2025, 9, 1, 12)))
    const v = deriveVault(log.getEvents(), NOW)
    expect(v.checklist.find((c) => c.id === 'updates').stale).toBe(true)
    expect(v.checklistStale).toBe(1)
  })

  it('grows the tree once per item; un-ticking and re-ticking cannot farm it', async () => {
    await log.append(securityEvent('email-2fa', true, new Date(2026, 4, 15, 12)))
    await log.append(securityEvent('email-2fa', false, new Date(2026, 4, 15, 13)))
    await log.append(securityEvent('email-2fa', true, new Date(2026, 4, 15, 14)))
    await log.append(securityEvent('phishing', true, new Date(2026, 4, 15, 15)))
    expect(deriveEvergrove(log.getEvents()).skills.discipline['digital-security'].xp).toBe(6)
  })

  it('is valid events all the way down', () => {
    expect(validateEvent(securityEvent('updates', true, NOW))).toBeFalsy()
  })
})
