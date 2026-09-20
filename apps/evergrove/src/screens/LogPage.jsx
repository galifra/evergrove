import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, Lock, RotateCcw, X } from 'lucide-react'
import { useApp } from '@evergrove/kit/AppContext.jsx'
import { useDialog } from '@evergrove/ui/components/useDialog.js'
import { Button, Card, Empty, Field, PageHeader, Select, TextInput } from '@evergrove/ui/components/ui.jsx'
import { DOMAINS } from '@evergrove/core/lib/domains.js'
import { describeVerification, verifyLog } from '@evergrove/rules/verify.js'
import {
  buildViewContext,
  deviceLabel,
  exportCsv,
  exportJson,
  filterChoices,
  filterEvents,
  growthLines,
  isPrivate,
  logStats,
  summarize,
} from '@evergrove/rules/logview.js'
import TimelinePage from './TimelinePage.jsx'

// The shared log, viewable (docs/v2). Everything every app has ever written, newest
// first, with filters and search. It is read-only: the one thing it can do is add a
// correcting entry, after a confirmation, and nothing is ever deleted.

const PAGE = 100
const STATUS_LABEL = { active: '', reversed: 'undone', replaced: 'replaced', reversal: 'undo' }
const STATUS_TONE = { reversed: 'bg-rose-500/15 text-rose-300', replaced: 'bg-amber-500/15 text-amber-300', reversal: 'bg-sky-500/15 text-sky-200' }

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

function useDebounced(value, ms = 200) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

function EventDrawer({ event, ctx, showPrivate, onClose, onOpen, onReverse }) {
  const ref = useDialog(!!event, onClose)
  const [confirming, setConfirming] = useState(false)
  useEffect(() => setConfirming(false), [event?.id])
  if (!event) return null
  const info = ctx.corrections.get(event.id)
  const masked = isPrivate(event, ctx) && !showPrivate
  const growth = growthLines(event, ctx)
  const canReverse = (info.status === 'active' && event.type !== 'command.executed') || (info.status === 'reversal' && info.by.length === 0)
  const raw = masked ? { ...event, data: { private: true } } : event
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Log entry"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md h-full overflow-y-auto bg-[#0e1a13] border-l border-white/10 p-5"
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <h2 className="font-display text-lg">{summarize(event, ctx, { showPrivate })}</h2>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-white/10">
            <X size={18} />
          </button>
        </div>
        {masked && (
          <p className="mb-3 text-xs text-white/60 flex items-center gap-1.5">
            <Lock size={12} /> Private. Turn on "Show private contents" to see what it says.
          </p>
        )}
        <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-white/50">Happened</dt><dd>{new Date(event.occurredAt).toLocaleString()}</dd>
          <dt className="text-white/50">Recorded</dt><dd>{new Date(event.recordedAt).toLocaleString()}</dd>
          <dt className="text-white/50">App</dt><dd>{ctx.names.get(event.app) ?? event.app}</dd>
          <dt className="text-white/50">Type</dt><dd className="break-all">{event.type}</dd>
          <dt className="text-white/50">Area</dt><dd>{event.area ?? 'none'}</dd>
          <dt className="text-white/50">Written by</dt><dd>{event.actor}, {deviceLabel(event)}</dd>
          <dt className="text-white/50">Id</dt><dd className="break-all text-xs text-white/60">{event.id}</dd>
        </dl>

        {growth.length > 0 && (
          <div className="mt-4">
            <h3 className="text-xs uppercase tracking-wide text-white/45 mb-1">Why the tree grew</h3>
            <ul className="text-sm space-y-0.5">{growth.map((g) => <li key={g}>{g}</li>)}</ul>
          </div>
        )}

        {(info.status !== 'active' || info.target || info.by.length > 0) && (
          <div className="mt-4">
            <h3 className="text-xs uppercase tracking-wide text-white/45 mb-1">Corrections</h3>
            <ul className="text-sm space-y-1">
              {info.status === 'reversed' && <li>This entry was undone.</li>}
              {info.status === 'replaced' && <li>A newer entry replaced this one.</li>}
              {info.target && <li>This entry {event.type === 'event.reversed' ? 'undoes' : 'replaces'} <button className="underline" onClick={() => onOpen(info.target)}>an earlier entry</button>.</li>}
              {info.by.map((id) => (
                <li key={id}>Undone or replaced by <button className="underline" onClick={() => onOpen(id)}>a later entry</button>.</li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-4">
          <h3 className="text-xs uppercase tracking-wide text-white/45 mb-1">Exactly as stored</h3>
          <pre className="text-xs whitespace-pre-wrap break-all rounded-lg bg-black/30 p-3 max-h-72 overflow-auto">{JSON.stringify(raw, null, 2)}</pre>
        </div>

        {canReverse && (
          <div className="mt-5 border-t border-white/10 pt-4">
            {!confirming ? (
              <Button variant="danger" onClick={() => setConfirming(true)}>
                <RotateCcw size={13} className="inline mr-1" />
                {info.status === 'reversal' ? 'Undo this undo' : 'Reverse this entry'}
              </Button>
            ) : (
              <div className="text-sm">
                <p className="mb-2 text-white/75">This adds a correcting entry. The original stays in the log, and you can undo the correction later.</p>
                <div className="flex gap-2">
                  <Button variant="danger" onClick={() => { onReverse(event.id); onClose() }}>Yes, reverse it</Button>
                  <Button variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function LogPage() {
  const { events, reverseEvent } = useApp()
  const [tab, setTab] = useState('events')
  const [f, setF] = useState({ app: '', type: '', area: '', actor: '', from: '', to: '', query: '' })
  const [showPrivate, setShowPrivate] = useState(false) // never remembered: it resets every visit
  const [limit, setLimit] = useState(PAGE)
  const [selectedId, setSelectedId] = useState(null)
  const [check, setCheck] = useState('')
  const query = useDebounced(f.query)
  const listTop = useRef(null)

  const ctx = useMemo(() => buildViewContext(events), [events])
  const choices = useMemo(() => filterChoices(events), [events])
  const stats = useMemo(() => logStats(events), [events])

  const rows = useMemo(
    () =>
      filterEvents(
        events,
        { apps: f.app ? [f.app] : [], types: f.type ? [f.type] : [], areas: f.area ? [f.area] : [], actors: f.actor ? [f.actor] : [], from: f.from, to: f.to, query, showPrivate },
        ctx
      ),
    [events, ctx, f.app, f.type, f.area, f.actor, f.from, f.to, query, showPrivate]
  )
  useEffect(() => setLimit(PAGE), [f.app, f.type, f.area, f.actor, f.from, f.to, query, showPrivate])

  const selected = selectedId ? events.find((e) => e.id === selectedId) : null
  const set = (patch) => setF((p) => ({ ...p, ...patch }))
  const filtered = f.app || f.type || f.area || f.actor || f.from || f.to || f.query

  return (
    <div className="grid gap-4">
      <PageHeader icon="scroll-text" title="Log" subtitle="Everything every app has written, newest first. Read-only: the only thing you can add here is a correction." />

      <div className="flex gap-2" role="tablist" aria-label="Log views">
        {[['events', 'Events'], ['growth', 'Growth timeline']].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`px-3 py-1.5 rounded-full text-sm border ${tab === id ? 'bg-emerald-500/20 border-emerald-400/30 text-emerald-200' : 'border-white/10 text-white/60 hover:bg-white/5'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'growth' ? (
        <TimelinePage />
      ) : (
        <>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <div>
                <span className="font-medium">{stats.count.toLocaleString()} entries</span>
                {stats.first && <span className="text-white/60"> from {stats.first} to {stats.last}</span>}
                <span className="text-white/60"> · {stats.corrections} correction{stats.corrections === 1 ? '' : 's'}</span>
              </div>
              <button className="text-xs underline text-white/60 hover:text-white/90" onClick={() => setCheck(describeVerification(verifyLog(events)))}>
                Check my data
              </button>
            </div>
            {check && <p role="status" className="mt-2 text-xs text-white/65">{check}</p>}
          </Card>

          <Card title="Find things">
            <div className="grid gap-3 sm:grid-cols-4 items-end">
              <div className="sm:col-span-2">
                <Field label="Search"><TextInput value={f.query} onChange={(e) => set({ query: e.target.value })} placeholder="milk, running, 2026-05-01..." /></Field>
              </div>
              <Field label="App"><Select value={f.app} onChange={(e) => set({ app: e.target.value })} options={[{ value: '', label: 'All apps' }, ...choices.apps.map((a) => ({ value: a, label: ctx.names.get(a) ?? a }))]} /></Field>
              <Field label="Type"><Select value={f.type} onChange={(e) => set({ type: e.target.value })} options={[{ value: '', label: 'All types' }, ...choices.types]} /></Field>
              <Field label="Area"><Select value={f.area} onChange={(e) => set({ area: e.target.value })} options={[{ value: '', label: 'All areas' }, ...DOMAINS.map((d) => ({ value: d.id, label: d.name }))]} /></Field>
              <Field label="Written by"><Select value={f.actor} onChange={(e) => set({ actor: e.target.value })} options={[{ value: '', label: 'Anyone' }, ...choices.actors]} /></Field>
              <Field label="From"><TextInput type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} /></Field>
              <Field label="To"><TextInput type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} /></Field>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={showPrivate} onChange={(e) => setShowPrivate(e.target.checked)} className="w-4 h-4 accent-emerald-500" />
                <Lock size={13} className="text-white/55" /> Show private contents
              </label>
              {filtered && <Button variant="ghost" onClick={() => setF({ app: '', type: '', area: '', actor: '', from: '', to: '', query: '' })}>Clear filters</Button>}
              <div className="ml-auto flex gap-2">
                <Button variant="ghost" onClick={() => download('evergrove-log.json', exportJson(rows, ctx, { showPrivate }), 'application/json')}><Download size={13} className="inline mr-1" />JSON</Button>
                <Button variant="ghost" onClick={() => download('evergrove-log.csv', exportCsv(rows, ctx, { showPrivate }), 'text/csv')}><Download size={13} className="inline mr-1" />CSV</Button>
              </div>
            </div>
            {!showPrivate && <p className="mt-2 text-xs text-white/50">Money, health, mind, people, Compass and vault entries show only their app until you turn this on, so it is safe to open near other people. Exports follow the same setting.</p>}
          </Card>

          <div ref={listTop} className="text-xs text-white/55">
            Showing {Math.min(limit, rows.length).toLocaleString()} of {rows.length.toLocaleString()}{filtered ? ' matching' : ''} entries.
          </div>
          {rows.length === 0 && <Empty>{events.length ? 'Nothing matches those filters.' : 'The log is empty. Log something and it appears here.'}</Empty>}
          <ul className="rounded-2xl border border-white/10 divide-y divide-white/5 overflow-hidden">
            {rows.slice(0, limit).map((e) => {
              const info = ctx.corrections.get(e.id)
              const priv = isPrivate(e, ctx)
              return (
                <li key={e.id}>
                  <button onClick={() => setSelectedId(e.id)} className="w-full text-left px-3 py-2 hover:bg-white/[0.04] flex items-start gap-3">
                    <span className="shrink-0 w-28 text-xs text-white/50 pt-0.5">{new Date(e.occurredAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm truncate ${info.status === 'reversed' || info.status === 'replaced' ? 'line-through text-white/45' : ''}`}>
                        {priv && !showPrivate && <Lock size={11} className="inline mr-1 text-white/45" />}
                        {summarize(e, ctx, { showPrivate })}
                      </span>
                      <span className="block text-[11px] text-white/45 truncate">{ctx.names.get(e.app) ?? e.app} · {e.type} · {e.actor}</span>
                    </span>
                    {STATUS_LABEL[info.status] && <span className={`shrink-0 text-[11px] px-1.5 py-0.5 rounded-full ${STATUS_TONE[info.status]}`}>{STATUS_LABEL[info.status]}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
          {rows.length > limit && (
            <div><Button variant="ghost" onClick={() => setLimit((n) => n + PAGE)}>Show {Math.min(PAGE, rows.length - limit)} more</Button></div>
          )}
        </>
      )}

      <EventDrawer event={selected} ctx={ctx} showPrivate={showPrivate} onClose={() => setSelectedId(null)} onOpen={(id) => setSelectedId(id)} onReverse={reverseEvent} />
    </div>
  )
}
