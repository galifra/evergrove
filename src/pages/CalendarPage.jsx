import { useMemo, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { useApp } from '../app/AppContext'
import { localDate } from '../core/events'
import { deriveCalendar, overlaps } from '../modules/calendar'
import { Button, Card, Empty, ErrorNote, Field, PageHeader, TextInput } from '../components/ui'
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

  const today = localDate()
  const upcoming = state.events.filter((e) => e.start.slice(0, 10) >= today)
  const clashes = new Set()
  for (let i = 0; i < upcoming.length; i++)
    for (let j = i + 1; j < upcoming.length; j++)
      if (overlaps(upcoming[i], upcoming[j])) {
        clashes.add(upcoming[i].id)
        clashes.add(upcoming[j].id)
      }

  const byDay = new Map()
  for (const e of upcoming) {
    const d = e.start.slice(0, 10)
    if (!byDay.has(d)) byDay.set(d, [])
    byDay.get(d).push(e)
  }

  async function add(e) {
    e.preventDefault()
    const args = { title, start: time ? `${date}T${time}` : date }
    if (time && endTime) args.end = `${date}T${endTime}`
    if (await act('calendar__add_event', args)) {
      setTitle('')
      setTime('')
      setEndTime('')
    }
  }

  async function move(ev) {
    if (!moveTo) return
    if (await act('calendar__reschedule_event', { event: ev.id, start: moveTo })) setMoving(null)
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
          <div className="sm:col-span-4"><Button type="submit" disabled={!title.trim() || !date || busy}>Add event</Button><ErrorNote>{error}</ErrorNote></div>
        </form>
      </Card>

      <Card title="Agenda">
        {upcoming.length === 0 && <Empty>Nothing scheduled.</Empty>}
        {[...byDay].map(([day, list]) => (
          <div key={day} className="mb-3">
            <div className="text-xs uppercase tracking-wide text-white/40 mb-1">
              {new Date(`${day}T00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
            </div>
            <ul className="space-y-1.5">
              {list.map((e) => (
                <li key={e.id} className="rounded-lg bg-white/5 border border-white/10 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate flex items-center gap-2">
                        {e.title}
                        {clashes.has(e.id) && <AlertTriangle size={14} className="text-amber-300 shrink-0" aria-label="Conflict" />}
                      </div>
                      <div className="text-xs text-white/40">{e.allDay ? 'All day' : e.start.slice(11)}{e.end && !e.allDay ? ` - ${e.end.slice(11)}` : ''}</div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button variant="ghost" onClick={() => { setMoving(e.id); setMoveTo(e.start.includes('T') ? e.start : `${e.start}T09:00`) }}>Move</Button>
                      <Button variant="danger" onClick={() => act('calendar__cancel_event', { event: e.id })} aria-label="Cancel event"><X size={15} /></Button>
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
