import { useMemo, useState } from 'react'
import { useApp } from '../app/AppContext'
import { go } from '../app/router'
import { AREAS } from '../core/events'
import { DOMAIN_MAP } from '../lib/domains'
import { listApps } from '../modules'
import { AppIcon, Button, Card, ErrorNote, Field, PageHeader, Select, TextInput } from '../components/ui'
import { useAction } from '../components/useAction'

export default function AppsPage() {
  const { events } = useApp()
  const apps = useMemo(() => listApps(events), [events])
  const { act, error, busy } = useAction()
  const [f, setF] = useState({ name: '', area: 'creativity', fields: '' })

  async function create(e) {
    e.preventDefault()
    // "Label" = text, "Label#" = number, "Label:a|b|c" = choice
    const fields = f.fields
      .split(',')
      .map((raw) => raw.trim())
      .filter(Boolean)
      .map((raw) => {
        if (raw.endsWith('#')) return { label: raw.slice(0, -1).trim(), type: 'number' }
        if (raw.includes(':')) {
          const [label, opts] = raw.split(':')
          return { label: label.trim(), type: 'select', options: opts.split('|').map((o) => o.trim()).filter(Boolean) }
        }
        return { label: raw, type: 'text' }
      })
    if (await act('evergrove__create_tracker', { name: f.name, area: f.area, fields })) {
      setF({ name: '', area: f.area, fields: '' })
    }
  }

  const modules = apps.filter((a) => a.kind === 'module')
  const trackers = apps.filter((a) => a.kind === 'tracker')

  const Tile = ({ a }) => (
    <button
      type="button"
      onClick={() => go(`/app/${a.id}`)}
      className="text-left rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 p-4 transition-colors"
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className="grid place-items-center w-8 h-8 rounded-lg" style={{ background: `${DOMAIN_MAP[a.area]?.color ?? '#4ade80'}22`, color: DOMAIN_MAP[a.area]?.glow ?? '#86efac' }}>
          <AppIcon name={a.icon} size={16} />
        </span>
        <span className="font-medium">{a.name}</span>
      </div>
      <p className="text-xs text-white/50 leading-relaxed">{a.description}</p>
      {a.sensitive && <p className="text-[11px] text-white/55 mt-2">Private</p>}
    </button>
  )

  return (
    <div className="grid gap-5">
      <PageHeader icon="trees" title="Apps" subtitle="Each one works on its own and feeds the tree. Tell Jarvis to use them, or open them here." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{modules.map((a) => <Tile key={a.id} a={a} />)}</div>
      <div>
        <h2 className="text-sm font-medium text-white/60 mb-2">Trackers</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{trackers.map((a) => <Tile key={a.id} a={a} />)}</div>
      </div>
      <Card title="Make a new tracker">
        <p className="text-xs text-white/55 mb-3">
          Or just tell Jarvis: "make me a tracker for my houseplants". Fields are comma separated. Add # for a number (Water ml#) or :a|b|c for a choice (Health:good|ok|poor).
        </p>
        <form onSubmit={create} className="grid gap-3 sm:grid-cols-3 items-end">
          <Field label="Name"><TextInput value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Plants" /></Field>
          <Field label="Grows"><Select value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} options={AREAS.map((a) => ({ value: a, label: DOMAIN_MAP[a].name }))} /></Field>
          <Field label="Fields"><TextInput value={f.fields} onChange={(e) => setF({ ...f, fields: e.target.value })} placeholder="Plant, Water ml#, Health:good|ok|poor" /></Field>
          <div className="sm:col-span-3"><Button type="submit" disabled={!f.name.trim() || !f.fields.trim() || busy}>Create tracker</Button><ErrorNote>{error}</ErrorNote></div>
        </form>
      </Card>
    </div>
  )
}
