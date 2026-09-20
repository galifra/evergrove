import { useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useApp } from '@evergrove/kit/AppContext.jsx'
import Link from '@evergrove/kit/components/Link.jsx'
import { Button, Card, ErrorNote, PageHeader } from '@evergrove/ui/components/ui.jsx'
import { createEvent } from '@evergrove/core/events.js'
import { effectiveEvents } from '@evergrove/core/events.js'
import { composeWeekly } from '@evergrove/rules/weekly.js'
import { askJarvis } from '../lib/jarvis.js'
import { buildWeeklyPolishRequest } from '../lib/notes.js'

// The weekly review (docs/v2/FEEDBACK-SPEC.md). Built here from your own data, so it is free and
// works offline. One optional AI call a week can polish the wording; it is never made unless
// you press the button, and the server refuses it once 80% of the month's AI budget is used.

export default function WeeklyScreen() {
  const { runtime, events, settings } = useApp()
  const { now, review } = useMemo(() => {
    const at = new Date()
    return { now: at, review: composeWeekly(events, at) }
  }, [events])
  const polished = useMemo(() => {
    let text = null
    for (const e of effectiveEvents(events)) if (e.type === 'weekly.polished' && e.data.week === review.range.from) text = e.data.text
    return text
  }, [events, review.range.from])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function polish() {
    setBusy(true)
    setError('')
    try {
      const persona = { style: settings.jarvisStyle, title: settings.jarvisTitle }
      const body = await askJarvis(buildWeeklyPolishRequest({ events, persona, now }))
      const text = body.content?.find((b) => b.type === 'text')?.text?.trim()
      if (!text) throw new Error('I could not put that into words. The plain review above still stands.')
      await runtime.log.append(createEvent({ type: 'weekly.polished', app: 'jarvis', actor: 'jarvis', data: { week: review.range.from, text: text.slice(0, 1200) } }))
    } catch (err) {
      setError(err.message || 'Could not reach the model.')
    } finally {
      setBusy(false)
    }
  }

  const cta = review.suggestion?.cta

  return (
    <div className="grid gap-4">
      <PageHeader icon="bot" title="Your week" subtitle={review.title} />

      {polished && (
        <Card title="In my words">
          <p className="text-sm text-white/90 whitespace-pre-line">{polished}</p>
        </Card>
      )}

      {review.sections.map((s) => (
        <Card key={s.id} title={s.title}>
          <ul className="space-y-1 text-sm text-white/85">
            {s.lines.map((l) => <li key={l}>{l}</li>)}
          </ul>
          {s.id === 'suggestion' && cta && <div className="mt-2 text-xs"><Link to={cta.route} className="underline text-sky-200 hover:text-sky-100">{cta.label}</Link></div>}
        </Card>
      ))}

      <Card>
        {polished ? (
          <p className="text-xs text-white/55">I've already put this week into words. That costs about a cent, once a week at most.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="ghost" onClick={polish} disabled={busy}>
              {busy ? <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Writing...</span> : 'Put it in my words'}
            </Button>
            <span className="text-xs text-white/55">Optional. One short AI call, about a cent. Anything private is left out, and it stops if the month's budget is running low.</span>
          </div>
        )}
        <ErrorNote>{error}</ErrorNote>
      </Card>
    </div>
  )
}
