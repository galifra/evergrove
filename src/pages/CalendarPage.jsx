import { useMemo, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { useApp } from '../app/AppContext'
import { localDate } from '../core/events'
import { deriveCalendar, expandCalendar, overlaps, REPEAT_LABEL } from '../modules/calendar'
import { deriveMoney, formatCents } from '../modules/money'
import { deriveTasks } from '../modules/tasks'
import { derivePeople } from '../modules/people'
import { Button, Card, Empty, ErrorNote, Field, PageHeader, Select, TextInput } from '../components/ui'
import { useAction } from '../components/useAction'

export default function CalendarPage() {
  const { events } = useApp()
  const state = useMemo(() => deriveCalendar(events), [events])
  const { act, error, busy } = useAction()
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(localDate())
  const [time, setTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [moving, setMoving] = useState(null)
  const [moveTo, setMoveTo] = useState('')
  const [repeat, setRepeat] = useState('')

  const today = localDate()
  const horizon = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() + 120)
    return localDate(d)
  }, [])
  const upcoming = useMemo(() => expandCalendar(state, today, horizon), [state, today, horizon])
  const clashes = new Set()
  for (let i = 0; i < upcoming.length; i++)
    for (let j = i + 1; j < upcoming.length; j++)
      if (overlaps(upcoming[i], upcoming[j])) {
        clashes.add(upcoming[i].id)
        clashes.add(upcoming[j].id)
      }

  // Read-only reminders pulled from the other apps: things with a date that
  // belong on a calendar even though they live elsewhere.
  const extras = useMemo(() => {
    const out = []
    const money = deriveMoney(events)
    for (const b of money.bills) {
      if (!b.paid && b.daysUntil <= 45) {
        out.push({ id: 'bill-' + b.id, day: b.overdue ? today : b.dueOn, kind: b.overdue ? 'Overdue bill' : 'Bill due', text: b.amountCents ? `${b.name} ${formatCents(b.amountCents)}` : b.name })
      }
    }
    for (const t of deriveTasks(events).open) {
      if (t.due) out.push({ id: 'task-' + t.id, day: t.due < today ? today : t.due, kind: t.due < today ? 'Overdue task' : 'Task due', text: t.title })
    }
    for (const p of derivePeople(events).upcomingBirthdays) {
      out.push({ id: 'bday-' + p.id, day: p.nextBirthday.date, kind: 'Birthday', text: p.name })
    }
    return out
  }, [events, today])

  const byDay = new Map()
  for (const e of upcoming) {
    const d = e.start.slice(0, 10)
    if (!byDay.has(d)) byDay.set(d, { events: [], extras: [] })
    byDay.get(d).events.push(e)
  }
  for (const x of extras) {
    if (!byDay.has(x.day)) byDay.set(x.day, { events: [], extras: [] })
    byDay.get(x.day).extras.push(x)
  }
  const days = [...byDay].sort(([a], [b]) => a.localeCompare(b))

  async function add(e) {
    e.preventDefault()
    const args = { title, start: time ? `${date}T${time}` : date }
    if (time && endTime) args.end = `${date}T${endTime}`
    if (repeat) args.repeat = repeat
    if (await act('calendar__add_event', args)) {
      setRepeat('')
      setTitle('')
      setTime('')
      setEndTime('')
    }
  }

  async function move(ev) {
    if (!moveTo) return
    if (await act('calendar__reschedule_event', { event: ev.seriesId, start: moveTo })) setMoving(null)
  }

  return (
    <div className="grid gap-4">
      <PageHeader icon="calendar" title="Calendar" subtitle="Everything coming up, with conflicts flagged." />
      <Card title="Add an event">
        <form onSubmit={add} className="grid gap-3 sm:grid-cols-4 items-end">
          <div className="sm:col-span-2"><Field label="What"><TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Dinner with Sam" /></Field></div>
          <Field label="Date"><TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Starts (blank = all day)"><TextInput type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
          <Field label="Ends"><TextInput type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} disabled={!time} /></Field>
          <Field label="Repeats"><Select value={repeat} onChange={(e) => setRepeat(e.target.value)} options={[{ value: '', label: 'Never' }, { value: 'daily', label: 'Every day' }, { value: 'weekly', label: 'Every week' }, { value: 'monthly', label: 'Every month' }, { value: 'yearly', label: 'Every year' }]} /></Field>
          <div className="sm:col-span-4"><Button type="submit" disabled={!title.trim() || !date || busy}>Add event</Button><ErrorNote>{error}</ErrorNote></div>
        </form>
      </Card>

      <Card title="Agenda">
        {days.length === 0 && <Empty>Nothing scheduled.</Empty>}
        {days.map(([day, { events: list, extras: notes }]) => (
          <div key={day} className="mb-3">
            <div className="text-xs uppercase tracking-wide text-white/55 mb-1">
              {new Date(`${day}T00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
            </div>
            <ul className="space-y-1.5">
              {notes.map((x) => (
                <li key={x.id} className="rounded-lg border border-dashed border-white/10 px-3 py-1.5 text-sm flex items-center gap-2">
                  <span className={`text-[11px] px-1.5 py-0.5 rounded-full shrink-0 ${x.kind.startsWith('Overdue') ? 'bg-rose-500/15 text-rose-300' : 'bg-white/8 text-white/50'}`}>{x.kind}</span>
                  <span className="truncate">{x.text}</span>
                </li>
              ))}
              {list.map((e) => (
                <li key={e.id} className="rounded-lg bg-white/5 border border-white/10 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate flex items-center gap-2">
                        {e.title}
                        {clashes.has(e.id) && <AlertTriangle size={14} className="text-amber-300 shrink-0" aria-label="Conflict" />}
                      </div>
                      <div className="text-xs text-white/55">{e.allDay ? 'All day' : e.start.slice(11)}{e.end && !e.allDay ? ` - ${e.end.slice(11)}` : ''}{e.recurrence ? ` · repeats ${REPEAT_LABEL(e.recurrence)}` : ''}</div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button variant="ghost" onClick={() => { setMoving(e.id); setMoveTo(e.start.includes('T') ? e.start : `${e.start}T09:00`) }}>{e.recurrence ? 'Move series' : 'Move'}</Button>
                      {e.recurrence && <Button variant="ghost" onClick={() => act('calendar__skip_occurrence', { event: e.seriesId, date: e.occurrence })}>Skip this one</Button>}
                      <Button variant="danger" onClick={() => act('calendar__cancel_event', { event: e.seriesId })} aria-label={e.recurrence ? 'Cancel the whole series' : 'Cancel event'}><X size={15} /></Button>
                    </div>
                  </div>
                  {moving === e.id && (
                    <div className="mt-2 flex gap-2 items-end">
                      <TextInput type="datetime-local" value={moveTo} onChange={(ev) => setMoveTo(ev.target.value)} />
                      <Button onClick={() => move(e)}>Save</Button>
                      <Button variant="ghost" onClick={() => setMoving(null)}>Cancel</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Card>
    </div>
  )
}
