import { useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import { useApp } from '../app/AppContext'
import { AREAS } from '../core/events'
import { DOMAIN_MAP } from '../lib/domains'
import { deriveGoals } from '../modules/goals'
import { Button, Card, Empty, ErrorNote, Field, PageHeader, ProgressBar, Select, TextInput } from '../components/ui'
import { useAction } from '../components/useAction'

export default function GoalsPage() {
  const { events } = useApp()
  const state = useMemo(() => deriveGoals(events), [events])
  const { act, error, busy } = useAction()
  const [title, setTitle] = useState('')
  const [area, setArea] = useState('health')
  const [date, setDate] = useState('')
  const [steps, setSteps] = useState('')

  async function create(e) {
    e.preventDefault()
    const milestones = steps.split('\n').map((s) => s.trim()).filter(Boolean)
    if (await act('goals__create_goal', { title, area, targetDate: date || undefined, milestones })) {
      setTitle('')
      setSteps('')
      setDate('')
    }
  }

  return (
    <div className="grid gap-4">
      <PageHeader icon="target" title="Goals" subtitle="Break big things into milestones. Each one grows the area it belongs to." />
      <Card title="New goal">
        <form onSubmit={create} className="grid gap-3 sm:grid-cols-3 items-end">
          <div className="sm:col-span-3"><Field label="Goal"><TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Run a 10k" /></Field></div>
          <Field label="Area"><Select value={area} onChange={(e) => setArea(e.target.value)} options={AREAS.map((a) => ({ value: a, label: DOMAIN_MAP[a].name }))} /></Field>
          <Field label="Target date"><TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <div className="sm:col-span-3">
            <Field label="Milestones (one per line)">
              <textarea rows={3} value={steps} onChange={(e) => setSteps(e.target.value)} className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm focus:outline-none focus:border-emerald-400/50" />
            </Field>
          </div>
          <div className="sm:col-span-3"><Button type="submit" disabled={!title.trim() || busy}>Create goal</Button><ErrorNote>{error}</ErrorNote></div>
        </form>
      </Card>

      {state.goals.length === 0 && <Empty>No goals yet.</Empty>}
      {state.goals.map((g) => (
        <Card key={g.id} title={g.title} right={<span className="text-xs text-white/40">{DOMAIN_MAP[g.area].name}{g.targetDate ? ` · by ${g.targetDate}` : ''}{g.status !== 'active' ? ` · ${g.status}` : ''}</span>}>
          <ProgressBar value={g.progress} color={DOMAIN_MAP[g.area].color} />
          <ul className="mt-3 space-y-1.5">
            {g.milestones.map((m) => (
              <li key={m.id} className="flex items-center gap-2 text-sm">
                <button
                  type="button"
                  disabled={m.done || g.status !== 'active'}
                  onClick={() => act('goals__complete_milestone', { goal: g.id, milestone: m.id })}
                  className={`grid place-items-center w-5 h-5 rounded border ${m.done ? 'bg-emerald-500 border-emerald-500 text-emerald-950' : 'border-white/25 hover:border-emerald-400'}`}
                  aria-label={`Complete ${m.text}`}
                >
                  {m.done && <Check size={12} />}
                </button>
                <span className={m.done ? 'line-through text-white/40' : ''}>{m.text}</span>
              </li>
            ))}
          </ul>
          {g.status === 'active' && (
            <div className="mt-3 flex gap-2">
              <Button variant="ghost" onClick={() => act('goals__complete_goal', { goal: g.id })}>Mark achieved</Button>
              <Button variant="danger" onClick={() => act('goals__drop_goal', { goal: g.id })}>Drop</Button>
            </div>
          )}
        </Card>
      ))}
    </div>
  )
}
