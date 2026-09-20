import { useMemo, useState } from 'react'
import { Lock, Pencil, Trash2 } from 'lucide-react'
import { useApp } from '@evergrove/kit/AppContext.jsx'
import { useAction } from '@evergrove/kit/components/useAction.js'
import { Button, Card, Empty, ErrorNote, Field, PageHeader, Select, TextInput } from '@evergrove/ui/components/ui.jsx'
import { CATEGORIES, MAX_NOTES, MAX_TEXT, deriveMemory, guessCategory, looksPrivate } from '@evergrove/modules/memory.js'

// What Jarvis remembers about you (docs/v2/MEMORY-SPEC.md). Every note is visible here,
// can be edited or removed, and nothing is added without you: typing a note below is
// your own command, and a note he offers in chat waits for your click.

const LABEL = { preference: 'Preference', routine: 'Routine', goal: 'Goal', person: 'Person', fact: 'Fact' }

function Note({ note, revealed, act, busy }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(note.text)
  const [confirm, setConfirm] = useState(false)
  const masked = note.private && !revealed

  async function save() {
    if (text.trim() && text.trim() !== note.text && (await act('memory__revise', { note: note.text, text: text.trim() }))) setEditing(false)
    else if (text.trim() === note.text) setEditing(false)
  }

  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex gap-2">
              <TextInput value={text} maxLength={MAX_TEXT} onChange={(e) => setText(e.target.value)} aria-label="Edit note" />
              <Button onClick={save} disabled={busy}>Save</Button>
              <Button variant="ghost" onClick={() => { setEditing(false); setText(note.text) }}>Cancel</Button>
            </div>
          ) : (
            <p className="text-sm">
              {masked ? (
                <span className="text-white/50 inline-flex items-center gap-1.5"><Lock size={12} /> Private note</span>
              ) : (
                note.text
              )}
            </p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-white/50">
            <Select
              aria-label="Category"
              value={note.category}
              onChange={(e) => act('memory__revise', { note: note.text, category: e.target.value })}
              options={CATEGORIES.map((c) => ({ value: c, label: LABEL[c] }))}
              className="!w-auto !py-0.5 !text-[11px]"
              disabled={masked}
            />
            <label className="inline-flex items-center gap-1 cursor-pointer">
              <input type="checkbox" className="accent-sky-400" checked={note.private} disabled={masked} onChange={(e) => act('memory__revise', { note: note.text, private: e.target.checked })} />
              Private
            </label>
            <span>{new Date(note.notedAt).toLocaleDateString()}</span>
            {note.role === 'name' && <span className="text-sky-200">what I call you</span>}
          </div>
        </div>
        {!editing && (
          <div className="flex gap-1.5 shrink-0">
            {!masked && <Button variant="ghost" onClick={() => setEditing(true)} aria-label="Edit note"><Pencil size={13} /></Button>}
            {!confirm ? (
              <Button variant="danger" onClick={() => setConfirm(true)} aria-label="Forget note"><Trash2 size={13} /></Button>
            ) : (
              <span className="flex gap-1.5 items-center text-xs">
                <Button variant="danger" onClick={() => act('memory__forget', { note: note.text })} disabled={busy}>Forget it</Button>
                <Button variant="ghost" onClick={() => setConfirm(false)}>Keep</Button>
              </span>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

export default function MemoryScreen() {
  const { events } = useApp()
  const { act, error, busy } = useAction()
  const memory = useMemo(() => deriveMemory(events), [events])
  const [showPrivate, setShowPrivate] = useState(false) // never remembered
  const [filter, setFilter] = useState('')
  const [text, setText] = useState('')
  const [category, setCategory] = useState('')
  const [isPrivate, setIsPrivate] = useState(null)

  const shown = memory.notes.filter((n) => !filter || n.category === filter).slice().reverse()
  const guessed = text.trim() ? { category: guessCategory(text), private: looksPrivate(text) } : null

  async function add(e) {
    e.preventDefault()
    const args = { text: text.trim(), via: 'command', category: category || guessed?.category, private: isPrivate ?? guessed?.private ?? false }
    if (await act('memory__remember', args)) {
      setText('')
      setCategory('')
      setIsPrivate(null)
    }
  }

  return (
    <div className="grid gap-4">
      <PageHeader icon="bot" title="What I remember" subtitle="Short notes about you. I only keep what you told me to, and you can change or remove any of it." />

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className="font-medium">{memory.count} of {MAX_NOTES} notes</span>
          <label className="flex items-center gap-2 cursor-pointer text-white/80">
            <input type="checkbox" className="accent-sky-400" checked={showPrivate} onChange={(e) => setShowPrivate(e.target.checked)} />
            <Lock size={13} className="text-white/55" /> Show private notes
          </label>
        </div>
        <p className="mt-2 text-xs text-white/55">Private notes are never sent to the AI unless you share "Memory" in Settings. Everything else I might mention in chat only when it helps.</p>
      </Card>

      <Card title="Add a note">
        <form onSubmit={add} className="grid gap-3 sm:grid-cols-4 items-end">
          <div className="sm:col-span-2"><Field label="Something to remember"><TextInput value={text} maxLength={MAX_TEXT} onChange={(e) => setText(e.target.value)} placeholder="I run best in the morning" /></Field></div>
          <Field label="Kind"><Select value={category || guessed?.category || 'fact'} onChange={(e) => setCategory(e.target.value)} options={CATEGORIES.map((c) => ({ value: c, label: LABEL[c] }))} /></Field>
          <label className="flex items-center gap-2 text-sm pb-2 cursor-pointer">
            <input type="checkbox" className="accent-sky-400" checked={isPrivate ?? guessed?.private ?? false} onChange={(e) => setIsPrivate(e.target.checked)} /> Private
          </label>
          <div className="sm:col-span-4"><Button type="submit" disabled={!text.trim() || busy}>Remember it</Button><ErrorNote>{error}</ErrorNote></div>
        </form>
      </Card>

      <Card title="Notes">
        <div className="mb-3 max-w-[12rem]">
          <Select aria-label="Filter notes" value={filter} onChange={(e) => setFilter(e.target.value)} options={[{ value: '', label: 'All kinds' }, ...CATEGORIES.map((c) => ({ value: c, label: LABEL[c] }))]} />
        </div>
        {shown.length === 0 ? (
          <Empty>{memory.count ? 'No notes of that kind.' : 'Nothing yet. Add one above, or tell me in chat: "remember that ..."'}</Empty>
        ) : (
          <ul className="divide-y divide-white/5">
            {shown.map((n) => <Note key={n.id} note={n} revealed={showPrivate} act={act} busy={busy} />)}
          </ul>
        )}
      </Card>
    </div>
  )
}
