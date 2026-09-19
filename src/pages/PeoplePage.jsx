import { useMemo, useState } from 'react'
import { useApp } from '../app/AppContext'
import { derivePeople } from '../modules/people'
import { Button, Card, Empty, ErrorNote, Field, PageHeader, TextInput } from '../components/ui'
import { useAction } from '../components/useAction'

const split = (s) => s.split(',').map((x) => x.trim()).filter(Boolean)

export default function PeoplePage() {
  const { events } = useApp()
  const state = useMemo(() => derivePeople(events), [events])
  const { act, error, busy } = useAction()
  const [f, setF] = useState({ name: '', relationship: '', birthday: '', likes: '', dislikes: '', gifts: '' })

  async function save(e) {
    e.preventDefault()
    const args = { name: f.name }
    if (f.relationship) args.relationship = f.relationship
    if (f.birthday) args.birthday = f.birthday.slice(5)
    if (f.likes) args.likes = split(f.likes)
    if (f.dislikes) args.dislikes = split(f.dislikes)
    if (f.gifts) args.giftIdeas = split(f.gifts)
    if (await act('people__save_person', args)) setF({ name: '', relationship: '', birthday: '', likes: '', dislikes: '', gifts: '' })
  }

  return (
    <div className="grid gap-4">
      <PageHeader icon="users" title="People" subtitle="The people who matter: birthdays, what they like, and when you last connected." />

      {state.upcomingBirthdays.length > 0 && (
        <Card title="Birthdays in the next 30 days">
          <ul className="text-sm space-y-1">
            {state.upcomingBirthdays.map((p) => (
              <li key={p.id}>{p.name}: {p.nextBirthday.date} ({p.nextBirthday.inDays === 0 ? 'today' : `in ${p.nextBirthday.inDays} days`})</li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Add or update someone">
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-3 items-end">
          <Field label="Name"><TextInput value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Relationship"><TextInput value={f.relationship} onChange={(e) => setF({ ...f, relationship: e.target.value })} placeholder="Brother, friend" /></Field>
          <Field label="Birthday"><TextInput type="date" value={f.birthday} onChange={(e) => setF({ ...f, birthday: e.target.value })} /></Field>
          <Field label="Likes (comma separated)"><TextInput value={f.likes} onChange={(e) => setF({ ...f, likes: e.target.value })} /></Field>
          <Field label="Dislikes"><TextInput value={f.dislikes} onChange={(e) => setF({ ...f, dislikes: e.target.value })} /></Field>
          <Field label="Gift ideas"><TextInput value={f.gifts} onChange={(e) => setF({ ...f, gifts: e.target.value })} /></Field>
          <div className="sm:col-span-3"><Button type="submit" disabled={!f.name.trim() || busy}>Save</Button><ErrorNote>{error}</ErrorNote></div>
        </form>
      </Card>

      <Card title="Everyone">
        {state.people.length === 0 && <Empty>No one saved yet.</Empty>}
        <div className="grid gap-3 sm:grid-cols-2">
          {state.people.map((p) => (
            <div key={p.id} className="rounded-xl bg-white/5 border border-white/10 p-3">
              <div className="flex justify-between gap-2">
                <div>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-white/55">{p.relationship || 'no relationship set'}{p.birthday ? ` · birthday ${p.birthday}` : ''}</div>
                </div>
                <div className="text-xs text-white/50 text-right">{p.lastContact ? `${p.daysSince}d ago` : 'no contact yet'}</div>
              </div>
              {p.likes.length > 0 && <div className="text-xs mt-2"><span className="text-white/55">Likes: </span>{p.likes.join(', ')}</div>}
              {p.giftIdeas.length > 0 && <div className="text-xs mt-1"><span className="text-white/55">Gift ideas: </span>{p.giftIdeas.join(', ')}</div>}
              <div className="mt-2 flex gap-2 flex-wrap">
                {['call', 'text', 'visit', 'gift'].map((k) => (
                  <Button key={k} variant="ghost" onClick={() => act('people__log_contact', { person: p.id, kind: k })}>{k}</Button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-white/55">Logging a contact grows Staying connected. Private area: not shared with Jarvis unless you allow it in Settings.</p>
      </Card>
    </div>
  )
}
