import { useMemo, useState } from 'react'
import { useApp } from '@evergrove/kit/AppContext.jsx'
import { appSpecMarkdown } from '@evergrove/rules/appSpec.js'
import { go } from '@evergrove/kit/router.js'
import { appPath } from '@evergrove/rules/routes.js'
import { AREAS } from '@evergrove/core/events.js'
import { DOMAIN_MAP } from '@evergrove/core/lib/domains.js'
import { listApps } from '@evergrove/rules/registry.js'
import { AppIcon, Button, Card, ErrorNote, Field, PageHeader, Select, TextInput } from '@evergrove/ui/components/ui.jsx'
import { useAction } from '@evergrove/kit/components/useAction.js'

export default function AppsPage() {
  const { events, evState, reverseEvent } = useApp()
  const [copied, setCopied] = useState(null)
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
      onClick={() => go(appPath(a.id))}
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
      <PageHeader icon="trees" title="Apps" subtitle="Each one works on its own and feeds the tree. Tell MOXIE to use them, or open them here." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{modules.map((a) => <Tile key={a.id} a={a} />)}</div>
      <div>
        <h2 className="text-sm font-medium text-white/60 mb-2">Trackers</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{trackers.map((a) => <Tile key={a.id} a={a} />)}</div>
      </div>
      {evState.appRequests.length > 0 && (
        <Card title="App ideas ready to build">
          <ul className="divide-y divide-white/5">
            {evState.appRequests.map((r) => (
              <li key={r.id} className="py-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{r.name}</div>
                  <div className="text-xs text-white/60">{r.purpose}</div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      await navigator.clipboard.writeText(appSpecMarkdown(r))
                      setCopied(r.id)
                    }}
                  >
                    {copied === r.id ? 'Copied' : 'Copy spec'}
                  </Button>
                  <Button variant="danger" onClick={() => reverseEvent(r.eventId)}>Remove</Button>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-xs text-white/55 mt-2">Copy a spec and hand it to me to build.</p>
        </Card>
      )}

      <Card title="Make a new tracker">
        <p className="text-xs text-white/55 mb-3">
          Or just tell MOXIE: "make me a tracker for my houseplants". Fields are comma separated. Add # for a number (Water ml#) or :a|b|c for a choice (Health:good|ok|poor).
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
