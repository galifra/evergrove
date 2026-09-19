import { useMemo, useState } from 'react'
import { Undo2 } from 'lucide-react'
import { useApp } from '../app/AppContext'
import { effectiveEvents, localDate } from '../core/events'
import { DOMAIN_MAP } from '../lib/domains'
import { Button, Card, Empty, ErrorNote, Field, PageHeader, Select, TextInput } from '../components/ui'
import { useAction } from '../components/useAction'

export default function TrackerPage({ trackerId }) {
  const { evState, events, reverseEvent } = useApp()
  const def = evState.trackers.find((t) => t.id === trackerId)
  const [values, setValues] = useState({})
  const { error, busy, act } = useAction()
  const [weekAgo] = useState(() => localDate(new Date(Date.now() - 6 * 86400000)))

  const entries = useMemo(
    () =>
      effectiveEvents(events)
        .filter((e) => e.type === 'tracker.entry' && e.data.trackerId === trackerId)
        .reverse(),
    [events, trackerId]
  )

  if (!def) return <Empty>That app doesn't exist yet. Ask Jarvis to create it, or make one from the Apps page.</Empty>

  const thisWeek = entries.filter((e) => localDate(e.occurredAt) >= weekAgo)
  const statTotal = def.stat
    ? thisWeek.reduce((s, e) => s + (Number(e.data.values?.[def.stat.field]) || 0), 0)
    : null

  async function submit(e) {
    e.preventDefault()
    const ok = await act('evergrove__log_tracker_entry', { tracker: def.id, values })
    if (ok) setValues({})
  }

  return (
    <div>
      <PageHeader
        icon={def.icon}
        title={def.name}
        subtitle={`${def.description} Grows ${DOMAIN_MAP[def.area].name}.`}
        right={
          <div className="text-right text-xs text-white/50 shrink-0">
            <div>{thisWeek.length} this week</div>
            {statTotal !== null && (
              <div>
                {statTotal} {def.stat.label}
              </div>
            )}
          </div>
        }
      />

      <Card title="Log an entry">
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          {def.fields.map((f) => (
            <Field key={f.key} label={`${f.label}${f.required ? ' *' : ''}`}>
              {f.type === 'select' ? (
                <Select
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                  options={[{ value: '', label: 'Choose...' }, ...f.options]}
                />
              ) : (
                <TextInput
                  type={f.type === 'number' ? 'number' : 'text'}
                  step="any"
                  placeholder={f.placeholder ?? ''}
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                />
              )}
            </Field>
          ))}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={busy}>
              Log it
            </Button>
            <ErrorNote>{error}</ErrorNote>
          </div>
        </form>
      </Card>

      <Card title="Recent" className="mt-4">
        {entries.length === 0 && <Empty>Nothing logged yet.</Empty>}
        <ul className="divide-y divide-white/5">
          {entries.slice(0, 40).map((e) => (
            <li key={e.id} className="py-2 flex items-center justify-between gap-3 text-sm">
              <div className="min-w-0">
                <div className="truncate">
                  {def.fields
                    .map((f) => e.data.values?.[f.key])
                    .filter((v) => v !== undefined && v !== '')
                    .join(' · ')}
                </div>
                <div className="text-xs text-white/40">{new Date(e.occurredAt).toLocaleString()}</div>
              </div>
              <Button variant="ghost" onClick={() => reverseEvent(e.id)} aria-label="Undo entry">
                <Undo2 size={14} />
              </Button>
            </li>
          ))}
        </ul>
      </Card>
      {def.sensitive && (
        <p className="text-xs text-white/35 mt-3">
          Private area: Jarvis doesn't see a summary of this unless you share it in Settings.
        </p>
      )}
    </div>
  )
}
