import { useEffect, useMemo, useRef, useState } from 'react'
import { ThumbsDown, ThumbsUp } from 'lucide-react'
import { useApp } from '@evergrove/kit/AppContext.jsx'
import Link from '@evergrove/kit/components/Link.jsx'
import { Button } from '@evergrove/ui/components/ui.jsx'
import { localDate, newId } from '@evergrove/core/events.js'
import { chooseNotes, feedbackState, observe } from '@evergrove/rules/observations.js'
import { coachSteps, feedbackEvent, noteShownEvent } from '../lib/notes.js'
import { deriveGoals } from '@evergrove/modules/goals.js'

// What MOXIE has to say unprompted, at most a couple of things a day and only when it matters
// (docs/v2/FEEDBACK-SPEC.md). Each note can be rated, and "not useful" quiets that kind for 30 days.
// Nothing here calls the AI: the notes are made from your own data and fixed wordings.

function Coach({ note, onDone }) {
  const { runtime, events } = useApp()
  const [steps, setSteps] = useState(null)
  const [state, setState] = useState('idle')
  const [error, setError] = useState('')

  const goal = useMemo(() => deriveGoals(events).active.find((g) => g.id === note.coach.goalId), [events, note.coach.goalId])
  if (!goal) return null

  async function approve() {
    setState('working')
    setError('')
    const correlationId = newId()
    for (const s of steps) {
      const r = await runtime.registry.invoke('tasks__add_task', s, { approved: true, actor: 'user', correlationId })
      if (r.status !== 'done') {
        setError(r.error ?? 'Could not add one of them.')
        setState('idle')
        return
      }
    }
    await runtime.log.append(feedbackEvent({ targetKind: 'note', targetId: note.obsId, value: 'up', extra: { key: note.key, coach: true } }))
    setState('done')
    onDone?.()
  }

  if (state === 'done') return <p className="mt-2 text-xs text-emerald-300">Added {steps.length} tasks to your list, each linked to the goal. You can undo them from the Log.</p>
  if (!steps) {
    return (
      <div className="mt-2">
        <Button variant="ghost" onClick={() => setSteps(coachSteps(goal))}>Split it into steps</Button>
      </div>
    )
  }
  return (
    <div className="mt-2 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-xs">
      <p className="text-white/70">I'd add these tasks, all toward "{goal.title}":</p>
      <ul className="mt-1 list-disc pl-5 text-white/80">{steps.map((s) => <li key={s.title}>{s.title} (due {s.due})</li>)}</ul>
      <div className="mt-2 flex gap-2">
        <Button onClick={approve} disabled={state === 'working'}>Add these {steps.length} tasks</Button>
        <Button variant="ghost" onClick={() => setSteps(null)}>Not now</Button>
      </div>
      {error && <p role="alert" className="mt-1 text-rose-300">{error}</p>}
    </div>
  )
}

function Note({ note, rating, rate }) {
  return (
    <li className="rounded-xl border border-sky-400/20 bg-sky-400/[0.06] px-4 py-3 text-sm">
      <p className="text-white/90">{note.text}</p>
      {note.cta && <div className="mt-1 text-xs"><Link to={note.cta.route} className="underline text-sky-200 hover:text-sky-100">{note.cta.label}</Link></div>}
      {note.coach && <Coach note={note} />}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-white/55">
        {rating ? (
          <span>{rating === 'not_useful' ? "Got it. I won't bring this kind up for 30 days." : rating === 'up' ? 'Thanks. Noted.' : 'Thanks. I will take that on board.'}</span>
        ) : (
          <>
            <button type="button" aria-label={`Helpful: ${note.text.slice(0, 50)}`} onClick={() => rate(note, 'up')} className="p-1 rounded hover:bg-white/10"><ThumbsUp size={13} /></button>
            <button type="button" aria-label={`Not helpful: ${note.text.slice(0, 50)}`} onClick={() => rate(note, 'down')} className="p-1 rounded hover:bg-white/10"><ThumbsDown size={13} /></button>
            <button type="button" aria-label={`Not useful, quiet this kind for 30 days: ${note.text.slice(0, 50)}`} onClick={() => rate(note, 'not_useful')} className="underline hover:text-white/80">Not useful</button>
          </>
        )}
      </div>
    </li>
  )
}

export default function JarvisNotes() {
  const { runtime, events, settings } = useApp()
  const written = useRef(new Set()) // keys already written this session, so a re-render never writes one twice
  // Worked out again whenever the data changes, at the moment it changes.
  const { now, show, fresh } = useMemo(() => {
    const at = new Date()
    return { now: at, ...chooseNotes(observe(events, at), events, at, { speakUp: settings.speakUp }) }
  }, [events, settings.speakUp])
  const ratings = useMemo(() => {
    const today = localDate(now)
    const out = new Map()
    for (const r of feedbackState(events, now).ratings) if (r.targetKind === 'note' && r.key && localDate(r.at) === today) out.set(r.key, r.value)
    return out
  }, [events, now])

  // Showing a note is what starts its cooldown, and it is recorded so every device knows.
  useEffect(() => {
    if (!runtime) return
    for (const c of fresh) {
      if (written.current.has(c.key)) continue
      written.current.add(c.key)
      runtime.log.append(noteShownEvent(c, now))
    }
  }, [runtime, fresh, now])

  const rate = (note, value) => runtime.log.append(feedbackEvent({ targetKind: 'note', targetId: note.obsId, value, extra: { key: note.key } }))

  if (!show.length) return null
  return (
    <ul aria-label="Notes from MOXIE" aria-live="polite" className="mt-2 mb-3 space-y-2">
      {show.map((n) => <Note key={n.key} note={n} rating={ratings.get(n.key)} rate={rate} />)}
    </ul>
  )
}
