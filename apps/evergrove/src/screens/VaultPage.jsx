import { useMemo, useState } from 'react'
import { Eye, EyeOff, Lock, Trash2 } from 'lucide-react'
import { useApp } from '@evergrove/kit/AppContext.jsx'
import { createEvent } from '@evergrove/core/events.js'
import { buildEmergencySheet, deriveVault, openItem, sealItem, securityEvent, unlockVault, VAULT_KINDS } from '@evergrove/modules/vault.js'
import { localDate } from '@evergrove/core/events.js'
import { Button, Card, Empty, ErrorNote, Field, PageHeader, Select, TextInput } from '@evergrove/ui/components/ui.jsx'

export default function VaultPage() {
  const { events, runtime } = useApp()
  const state = useMemo(() => deriveVault(events), [events])
  const [key, setKey] = useState(null)
  const [pass, setPass] = useState('')
  const [error, setError] = useState('')
  const [revealed, setRevealed] = useState({})
  const [form, setForm] = useState({ title: '', kind: VAULT_KINDS[0], body: '' })
  const [sheet, setSheet] = useState('')
  const [note, setNote] = useState('')
  const [copied, setCopied] = useState(false)
  const { evState } = useApp()

  async function makeSheet() {
    setError('')
    try {
      const opened = []
      for (const it of state.items) if (['emergency contact', 'contingency plan'].includes(it.kind)) opened.push({ title: it.title, kind: it.kind, body: await openItem(key, it) })
      setSheet(buildEmergencySheet({ items: opened, treeName: evState.treeName ?? 'Evergrove', generatedOn: localDate(), passphraseNote: note }))
    } catch {
      setError('Could not open the emergency items with this passphrase.')
    }
  }

  function downloadSheet() {
    const url = URL.createObjectURL(new Blob([sheet], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'emergency-sheet.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function copySheet() {
    try {
      await navigator.clipboard.writeText(sheet)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Copying was blocked. Use Download instead.')
    }
  }

  async function unlock(e) {
    e.preventDefault()
    setError('')
    const k = await unlockVault(pass)
    // Prove the passphrase against an existing item so a typo never "unlocks" garbage.
    if (state.items[0]) {
      try {
        await openItem(k, state.items[0])
      } catch {
        setError('That passphrase does not open your existing items.')
        return
      }
    }
    setKey(k)
    setPass('')
  }

  async function save(e) {
    e.preventDefault()
    const sealed = await sealItem(key, form)
    await runtime.log.append(createEvent({ type: 'vault.item.saved', app: 'vault', data: sealed }))
    setForm({ title: '', kind: VAULT_KINDS[0], body: '' })
  }

  async function toggle(item) {
    if (revealed[item.id] !== undefined) {
      setRevealed(({ [item.id]: _drop, ...rest }) => rest)
      return
    }
    try {
      setRevealed({ ...revealed, [item.id]: await openItem(key, item) })
    } catch {
      setError('Could not open that item with this passphrase.')
    }
  }

  const tick = (id, checked) => runtime.log.append(securityEvent(id, checked))

  const checklistCard = (
    <Card title={`Digital security checklist (${state.checklistDone} of ${state.checklist.length})`}>
      <ul className="divide-y divide-white/5">
        {state.checklist.map((c) => (
          <li key={c.id} className="py-2">
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" className="mt-1" checked={c.done} onChange={(e) => tick(c.id, e.target.checked)} />
              <span className="min-w-0">
                <span className="block text-sm">{c.title}</span>
                <span className="block text-xs text-white/55">{c.why}</span>
                {c.stale && <span className="block text-xs text-amber-300">Last ticked {c.checkedOn}. Worth a fresh look.</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-white/55">You tick these yourself; nothing is checked or sent anywhere.</p>
    </Card>
  )

  return (
    <div className="grid gap-4">
      <PageHeader icon="lock" title="Vault" subtitle="IDs, legal records, emergency contacts and contingency plans, encrypted with a passphrase only you know." />
      {!key ? (
        <Card title={state.items.length ? 'Unlock' : 'Create your vault passphrase'}>
          <form onSubmit={unlock} className="flex flex-wrap gap-3 items-end">
            <Field label="Vault passphrase"><TextInput type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="off" /></Field>
            <Button type="submit" disabled={pass.length < 6}>{state.items.length ? 'Unlock' : 'Start vault'}</Button>
          </form>
          <ErrorNote>{error}</ErrorNote>
          <p className="text-xs text-white/55 mt-3">
            The passphrase stays in memory only while unlocked and is never sent anywhere. It cannot be recovered. If you forget it, the items cannot be opened. Jarvis never sees this area.
          </p>
        </Card>
      ) : (
        <>
          <Card title="Add an item" right={<Button variant="ghost" onClick={() => { setKey(null); setRevealed({}) }}><Lock size={13} className="inline mr-1" />Lock</Button>}>
            <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
              <Field label="Title (visible in the list, keep it non-secret)"><TextInput value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Passport" /></Field>
              <Field label="Type"><Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} options={VAULT_KINDS} /></Field>
              <div className="sm:col-span-2">
                <Field label="Secret contents (encrypted)">
                  <textarea rows={3} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm focus:outline-none focus:border-emerald-400/50" />
                </Field>
              </div>
              <div className="sm:col-span-2"><Button type="submit" disabled={!form.title.trim() || !form.body.trim()}>Encrypt and save</Button></div>
            </form>
          </Card>
          <Card title="Items">
            <ErrorNote>{error}</ErrorNote>
            {state.items.length === 0 && <Empty>Nothing stored yet.</Empty>}
            <ul className="divide-y divide-white/5">
              {state.items.map((it) => (
                <li key={it.id} className="py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0"><div className="truncate">{it.title}</div><div className="text-xs text-white/55">{it.kind}</div></div>
                    <div className="flex gap-2 shrink-0">
                      <Button variant="ghost" onClick={() => toggle(it)} aria-label="Show or hide">{revealed[it.id] !== undefined ? <EyeOff size={14} /> : <Eye size={14} />}</Button>
                      <Button variant="danger" onClick={() => { if (confirm(`Delete "${it.title}"?`)) runtime.log.append(createEvent({ type: 'vault.item.deleted', app: 'vault', data: { itemId: it.id } })) }} aria-label="Delete"><Trash2 size={14} /></Button>
                    </div>
                  </div>
                  {revealed[it.id] !== undefined && <pre className="mt-2 whitespace-pre-wrap text-sm rounded-lg bg-black/30 p-3 font-sans">{revealed[it.id]}</pre>}
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Emergency sheet">
            <p className="text-sm text-white/70">Gathers your emergency contacts and contingency plans into one page for someone you trust to find. It never includes the vault passphrase.</p>
            <div className="mt-3 max-w-lg">
              <Field label="Where is the vault passphrase kept? (e.g. sealed envelope in the safe)">
                <TextInput value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
              </Field>
            </div>
            <div className="mt-3"><Button onClick={makeSheet}>Build the sheet</Button></div>
            {sheet && (
              <div className="mt-3">
                <pre className="whitespace-pre-wrap text-sm rounded-lg bg-black/30 p-3 font-sans max-h-80 overflow-auto">{sheet}</pre>
                <p className="mt-2 text-xs text-amber-300">This text is not encrypted. Print it or save it somewhere physical, then clear it from here.</p>
                <div className="mt-2 flex gap-2">
                  <Button variant="ghost" onClick={copySheet}>{copied ? 'Copied' : 'Copy'}</Button>
                  <Button variant="ghost" onClick={downloadSheet}>Download</Button>
                  <Button variant="ghost" onClick={() => setSheet('')}>Clear</Button>
                </div>
              </div>
            )}
          </Card>
        </>
      )}
      {checklistCard}
    </div>
  )
}
