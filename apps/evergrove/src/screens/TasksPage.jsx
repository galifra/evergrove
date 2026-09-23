import { useMemo, useState } from 'react'
import { Check, Flame, Trash2, Undo2 } from 'lucide-react'
import { useApp } from '@evergrove/kit/AppContext.jsx'
import { AREAS } from '@evergrove/core/events.js'
import { DOMAIN_MAP } from '@evergrove/core/lib/domains.js'
import { deriveTasks } from '@evergrove/modules/tasks.js'
import { deriveGoals } from '@evergrove/modules/goals.js'
import { Button, Card, Empty, ErrorNote, Field, PageHeader, Select, TextInput, ProgressBar } from '@evergrove/ui/components/ui.jsx'
import { useAction } from '@evergrove/kit/components/useAction.js'

const REPEATS = [
  { value: '0', label: 'Never' },
  { value: '1', label: 'Every day' },
  { value: '7', label: 'Every week' },
  { value: '14', label: 'Every 2 weeks' },
  { value: '30', label: 'Every month' },
  { value: '90', label: 'Every 3 months' },
  { value: '365', label: 'Every year' },
]

export default function TasksPage() {
  const { events, reverseEvent } = useApp()
  const state = useMemo(() => deriveTasks(events), [events])
  const task = useAction()
  const habit = useAction()
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [effort, setEffort] = useState('1')
  const [repeat, setRepeat] = useState('0')
  const [goal, setGoal] = useState('')
  const goals = useMemo(() => deriveGoals(events).active, [events])
  const [hName, setHName] = useState('')
  const [hArea, setHArea] = useState('health')
  const [cadence, setCadence] = useState('daily')
  const [target, setTarget] = useState('3')

  const goalTitle = (id) => goals.find((g) => g.id === id)?.title

  async function addTask(e) {
    e.preventDefault()
    const args = { title, due: due || undefined, effort: Number(effort) }
    if (Number(repeat) > 0) args.repeatEveryDays = Number(repeat)
    if (goal) args.goal = goal
    if (await task.act('tasks__add_task', args)) {
      setTitle('')
      setDue('')
      setRepeat('0')
      setGoal('')
    }
  }

  async function addHabit(e) {
    e.preventDefault()
    const args = { name: hName, area: hArea, cadence }
    if (cadence === 'weekly') args.target = Number(target)
    if (await habit.act('tasks__add_habit', args)) setHName('')
  }

  return (
    <div className="grid gap-4">
      <PageHeader icon="check-square" title="Tasks & habits" subtitle="One-off tasks and the habits that keep you consistent." />

      <Card title="Habits">
        {state.habits.length === 0 && <Empty>No habits yet. Add one below, or tell MOXIE.</Empty>}
        <div className="grid gap-3 sm:grid-cols-2">
          {state.habits.map((h) => (
            <div key={h.id} className="rounded-xl bg-white/5 border border-white/10 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium truncate">{h.name}</div>
                  <div className="text-xs text-white/55">
                    {DOMAIN_MAP[h.area].name} · {h.cadence === 'weekly' ? `${h.thisWeek}/${h.target} this week` : 'daily'}
                  </div>
                </div>
                <Button
                  variant={h.checkedToday ? 'ghost' : 'primary'}
                  disabled={h.checkedToday}
                  onClick={() => habit.act('tasks__check_habit', { habit: h.id })}
                >
                  {h.checkedToday ? 'Done' : 'Check off'}
                </Button>
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs text-white/50">
                <Flame size={13} className={h.streak ? 'text-amber-300' : ''} /> {h.streak} {h.cadence === 'weekly' ? 'week' : 'day'} streak
              </div>
              {h.cadence === 'weekly' && <div className="mt-2"><ProgressBar value={h.thisWeek / h.target} /></div>}
            </div>
          ))}
        </div>
        <form onSubmit={addHabit} className="mt-4 grid gap-3 sm:grid-cols-4 items-end">
          <Field label="New habit"><TextInput value={hName} onChange={(e) => setHName(e.target.value)} placeholder="Stretch, read, pray" /></Field>
          <Field label="Area"><Select value={hArea} onChange={(e) => setHArea(e.target.value)} options={AREAS.map((a) => ({ value: a, label: DOMAIN_MAP[a].name }))} /></Field>
          <Field label="Cadence"><Select value={cadence} onChange={(e) => setCadence(e.target.value)} options={['daily', 'weekly']} /></Field>
          {cadence === 'weekly' ? (
            <Field label="Times per week"><TextInput type="number" min="1" max="7" value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
          ) : (
            <div />
          )}
          <div className="sm:col-span-4"><Button type="submit" disabled={!hName.trim() || habit.busy}>Add habit</Button><ErrorNote>{habit.error}</ErrorNote></div>
        </form>
      </Card>

      <Card title="Tasks">
        <form onSubmit={addTask} className="grid gap-3 sm:grid-cols-4 items-end">
          <div className="sm:col-span-2"><Field label="New task"><TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="File taxes" /></Field></div>
          <Field label="Due"><TextInput type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
          <Field label="Size"><Select value={effort} onChange={(e) => setEffort(e.target.value)} options={[{ value: '1', label: 'Quick' }, { value: '2', label: 'Medium' }, { value: '3', label: 'Big' }]} /></Field>
          <Field label="Repeats"><Select value={repeat} onChange={(e) => setRepeat(e.target.value)} options={REPEATS} /></Field>
          <Field label="Toward goal"><Select value={goal} onChange={(e) => setGoal(e.target.value)} options={[{ value: '', label: 'No goal' }, ...goals.map((g) => ({ value: g.id, label: g.title }))]} /></Field>
          <div className="sm:col-span-4"><Button type="submit" disabled={!title.trim() || task.busy}>Add task</Button><ErrorNote>{task.error}</ErrorNote></div>
        </form>

        <ul className="mt-4 divide-y divide-white/5">
          {state.open.length === 0 && <Empty>Nothing open. Nice.</Empty>}
          {state.open.map((t) => (
            <li key={t.id} className="py-2 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate">{t.title}</div>
                <div className="text-xs text-white/55">
                  {t.due ? `due ${t.due}` : 'no date'} · {['quick', 'medium', 'big'][t.effort - 1]}
                  {t.repeatEveryDays ? ` · repeats every ${t.repeatEveryDays === 7 ? 'week' : t.repeatEveryDays + ' days'}` : ''}
                  {t.goalId && goalTitle(t.goalId) ? ` · toward ${goalTitle(t.goalId)}` : ''}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button variant="primary" onClick={() => task.act('tasks__complete_task', { task: t.id })} aria-label="Complete task"><Check size={15} /></Button>
                <Button variant="danger" onClick={() => task.act('tasks__delete_task', { task: t.id })} aria-label="Delete task"><Trash2 size={15} /></Button>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {state.doneToday.length > 0 && (
        <Card title="Done today">
          <ul className="divide-y divide-white/5">
            {state.doneToday.map((t) => (
              <li key={t.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                <span className="line-through text-white/50 truncate">{t.title}</span>
                <Button variant="ghost" onClick={() => reverseEvent(t.completionEventId)} aria-label="Reopen task"><Undo2 size={14} /></Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
