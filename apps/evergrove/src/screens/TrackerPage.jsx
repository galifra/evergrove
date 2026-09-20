import { useMemo, useState } from 'react'
import { Undo2 } from 'lucide-react'
import { useApp } from '@evergrove/kit/AppContext.jsx'
import { effectiveEvents, localDate } from '@evergrove/core/events.js'
import { DOMAIN_MAP } from '@evergrove/core/lib/domains.js'
import { weeklyTotals } from '@evergrove/rules/trackers.js'
import { REVIEW_PROMPTS, trackerBlocks, yearInReview } from '@evergrove/rules/trackerViews.js'
import { Button, Card, Empty, ErrorNote, Field, PageHeader, Select, TextInput } from '@evergrove/ui/components/ui.jsx'
import { useAction } from '@evergrove/kit/components/useAction.js'

export default function TrackerPage({ trackerId }) {
  const { evState, events, reverseEvent } = useApp()
  const def = evState.trackers.find((t) => t.id === trackerId)
  const [values, setValues] = useState({})
  const [answers, setAnswers] = useState({})
  const review = useAction()
  const { error, busy, act } = useAction()
  const [weekAgo] = useState(() => localDate(new Date(Date.now() - 6 * 86400000)))

  const entries = useMemo(
    () =>
      effectiveEvents(events)
        .filter((e) => e.type === 'tracker.entry' && e.data.trackerId === trackerId)
        .reverse(),
    [events, trackerId]
  )

  const blocks = useMemo(() => trackerBlocks(trackerId, events), [events, trackerId])
  const year = String(new Date().getFullYear())
  const yearReview = useMemo(() => (trackerId === 'compass' ? yearInReview(evState, Number(year)) : null), [trackerId, evState, year])

  if (!def) return <Empty>That app doesn't exist yet. Ask Jarvis to create it, or make one from the Apps page.</Empty>

  const thisWeek = entries.filter((e) => localDate(e.occurredAt) >= weekAgo)
  const statTotal = def.stat
    ? thisWeek.reduce((s, e) => s + (Number(e.data.values?.[def.stat.field]) || 0), 0)
    : null

  const weeks = weeklyTotals(entries, def)
  const peak = Math.max(1, ...weeks.map((w) => w.value))
  const unit = def.stat ? def.stat.label : entries.length === 1 ? 'entry' : 'entries'

  async function markReviewed(q) {
    await review.act('evergrove__log_tracker_entry', { tracker: 'learning', values: { subject: q.subject, remember: q.remember, type: 'review' } })
  }

  async function saveYearReview(e) {
    e.preventDefault()
    for (const p of REVIEW_PROMPTS) {
      const text = (answers[p.id] ?? '').trim()
      if (!text) continue
      const ok = await review.act('evergrove__log_tracker_entry', { tracker: 'compass', values: { kind: 'review', title: `${year} review: ${p.label}`.slice(0, 200), notes: text } })
      if (!ok) return
    }
    setAnswers({})
  }

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

      {blocks.map((b) => (
        <Card key={b.id} title={b.title} className={`mb-4 ${b.tone === 'gentle' ? 'border-emerald-300/20' : ''}`}>
          <ul className="text-sm space-y-1 text-white/80">
            {b.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {b.series && (
            <div className="mt-2 flex items-end gap-1 h-8" role="img" aria-label={`Recent moods: ${b.series.join(', ')}`}>
              {b.series.map((m, i) => (
                <div key={i} className="flex-1 rounded-sm bg-white/40" style={{ height: `${m * 20}%` }} />
              ))}
            </div>
          )}
          {b.reviews && (
            <ul className="mt-3 divide-y divide-white/5">
              {b.reviews.map((q) => (
                <li key={q.key} className="py-2 flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">{q.subject}: {q.remember} <span className="text-white/55">(review {q.step} of {q.of})</span></span>
                  <Button variant="primary" disabled={review.busy} onClick={() => markReviewed(q)}>Reviewed</Button>
                </li>
              ))}
            </ul>
          )}
          {b.reviews && <ErrorNote>{review.error}</ErrorNote>}
        </Card>
      ))}

      {yearReview && (
        <Card title={`Your ${year} in review`} className="mb-4">
          {yearReview.totalXp === 0 ? (
            <Empty>Nothing grown yet this year. Log something and it appears here.</Empty>
          ) : (
            <div className="text-sm space-y-2">
              <p>{yearReview.activeDays} days with growth, {yearReview.totalXp} xp in total.</p>
              <ul className="space-y-1">
                {yearReview.areas.filter((a) => a.xp > 0).map((a) => (
                  <li key={a.area} className="flex justify-between"><span>{a.name}</span><span className="text-white/60">{a.xp} xp</span></li>
                ))}
              </ul>
              {yearReview.topSkills.length > 0 && <p className="text-white/70">Most-grown skills: {yearReview.topSkills.map((s) => s.name).join(', ')}.</p>}
              {yearReview.quiet.length > 0 && <p className="text-white/70">Quiet this year: {yearReview.quiet.join(', ')}. That may be exactly right, or worth a look.</p>}
            </div>
          )}
          <form onSubmit={saveYearReview} className="mt-4 grid gap-3">
            {REVIEW_PROMPTS.map((p) => (
              <Field key={p.id} label={p.label}>
                <TextInput maxLength={200} value={answers[p.id] ?? ''} onChange={(e) => setAnswers({ ...answers, [p.id]: e.target.value })} />
              </Field>
            ))}
            <div>
              <Button type="submit" disabled={review.busy || !REVIEW_PROMPTS.some((p) => (answers[p.id] ?? '').trim())}>Save my review</Button>
              <ErrorNote>{review.error}</ErrorNote>
            </div>
          </form>
        </Card>
      )}

      <Card title={`Last 8 weeks (${def.stat ? def.stat.label : 'entries'} per week)`} className="mt-4">
        <div className="flex items-end gap-2 h-24" role="img" aria-label="Weekly totals">
          {weeks.map((w, i) => (
            <div key={w.start} className="flex-1 flex flex-col items-center justify-end h-full min-w-0" title={`Week of ${w.start}: ${w.value} ${unit}`}>
              <span className="text-[10px] text-white/55 mb-0.5">{w.value || ''}</span>
              <div
                className="w-full rounded-t-md"
                style={{
                  height: `${Math.max(w.value ? 6 : 2, (w.value / peak) * 100)}%`,
                  background: DOMAIN_MAP[def.area].color,
                  opacity: i === weeks.length - 1 ? 1 : 0.55,
                }}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[10px] text-white/55 mt-1">
          <span>{weeks[0].start.slice(5)}</span>
          <span>this week</span>
        </div>
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
                <div className="text-xs text-white/55">{new Date(e.occurredAt).toLocaleString()}</div>
              </div>
              <Button variant="ghost" onClick={() => reverseEvent(e.id)} aria-label="Undo entry">
                <Undo2 size={14} />
              </Button>
            </li>
          ))}
        </ul>
      </Card>
      {def.sensitive && (
        <p className="text-xs text-white/55 mt-3">
          Private area: Jarvis doesn't see a summary of this unless you share it in Settings.
        </p>
      )}
    </div>
  )
}
