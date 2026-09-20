import { useMemo, useState } from 'react'
import { Undo2 } from 'lucide-react'
import { useApp } from '@evergrove/kit/AppContext.jsx'
import { localDate } from '@evergrove/core/events.js'
import { DOMAINS, DOMAIN_MAP } from '@evergrove/core/lib/domains.js'
import { Card, Empty, PageHeader, Select } from '@evergrove/ui/components/ui.jsx'

// Everything that has ever grown the tree, newest first: the honest answer to
// "why is my tree the way it is". Anything can be undone from here.
export default function TimelinePage() {
  const { viewState, reverseEvent } = useApp()
  const [area, setArea] = useState('all')

  const days = useMemo(() => {
    const byDay = new Map()
    for (const e of viewState.entries) {
      const updates = area === 'all' ? e.updates : e.updates.filter((u) => u.domain === area)
      if (!updates.length) continue
      const day = localDate(e.createdAt)
      if (!byDay.has(day)) byDay.set(day, [])
      byDay.get(day).push({ ...e, updates })
    }
    return [...byDay]
  }, [viewState.entries, area])

  const total = days.reduce((s, [, list]) => s + list.reduce((a, e) => a + e.updates.reduce((x, u) => x + u.xpGain, 0), 0), 0)

  return (
    <div className="grid gap-4">
      <PageHeader
        icon="trees"
        title="Timeline"
        subtitle="Everything that has grown your tree, newest first."
        right={
          <Select
            aria-label="Filter by area"
            value={area}
            onChange={(e) => setArea(e.target.value)}
            options={[{ value: 'all', label: 'All areas' }, ...DOMAINS.map((d) => ({ value: d.id, label: d.name }))]}
          />
        }
      />
      {days.length === 0 && <Empty>Nothing here yet. Log something and it will show up.</Empty>}
      {days.length > 0 && <p className="text-xs text-white/55">{total} xp across {days.length} day{days.length === 1 ? '' : 's'}.</p>}
      {days.map(([day, list]) => (
        <Card
          key={day}
          title={new Date(`${day}T00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}
        >
          <ul className="divide-y divide-white/5">
            {list.map((e) => (
              <li key={e.id} className="py-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm truncate">{e.text}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {e.updates.map((u, i) => (
                      <span
                        key={i}
                        className="text-[11px] px-2 py-0.5 rounded-full"
                        style={{ background: `${DOMAIN_MAP[u.domain].color}22`, color: DOMAIN_MAP[u.domain].glow }}
                      >
                        {u.skillName} +{u.xpGain}
                      </span>
                    ))}
                    <span className="text-[11px] text-white/55">{new Date(e.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                  </div>
                </div>
                <button
                  onClick={() => reverseEvent(e.id)}
                  className="shrink-0 p-1.5 rounded-lg text-white/55 hover:text-rose-300 hover:bg-white/5"
                  aria-label="Undo this"
                >
                  <Undo2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  )
}
