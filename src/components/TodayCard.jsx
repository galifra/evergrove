import { useMemo, useState } from 'react'
import { ChevronRight, X } from 'lucide-react'
import { useApp } from '../app/AppContext'
import { go } from '../app/router'
import { localDate } from '../core/events'
import { deriveToday, snoozeUntil, visibleToday } from '../evergrove/today'

const KEY = 'evergrove_today_snooze_v1'

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}')
  } catch {
    return {}
  }
}

const DOT = { 1: 'bg-rose-400', 2: 'bg-amber-300', 3: 'bg-emerald-300', 4: 'bg-white/30' }

// One calm list of what needs you today. Dismissing an item hides it until
// tomorrow (a week for "quiet area" nudges), so nothing nags twice.
export default function TodayCard() {
  const { events } = useApp()
  const [snoozes, setSnoozes] = useState(load)
  const items = useMemo(() => deriveToday(events), [events])
  const shown = visibleToday(items, snoozes).slice(0, 6)

  function dismiss(item) {
    const next = { ...snoozes, [item.id]: snoozeUntil(item) }
    // forget snoozes that have already expired so this never grows
    const today = localDate()
    for (const [k, v] of Object.entries(next)) if (v < today) delete next[k]
    setSnoozes(next)
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      // a lost snooze just means the item shows again
    }
  }

  return (
    <section className="mt-5 w-full max-w-xl rounded-2xl bg-white/[0.04] border border-white/10 p-4" aria-label="Today">
      <h2 className="text-sm font-medium text-white/70 mb-2">Today</h2>
      {shown.length === 0 ? (
        <p className="text-sm text-white/40 italic">Nothing pressing. Enjoy the day.</p>
      ) : (
        <ul className="space-y-1">
          {shown.map((i) => (
            <li key={i.id} className="flex items-center gap-2 group">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${DOT[i.priority]}`} />
              <button onClick={() => go(i.route)} className="flex-1 min-w-0 text-left text-sm text-white/80 hover:text-white py-1 flex items-center gap-1">
                <span className="truncate">{i.text}</span>
                <ChevronRight size={13} className="shrink-0 text-white/30" />
              </button>
              <button onClick={() => dismiss(i)} className="p-1 rounded text-white/30 hover:text-white/70" aria-label="Dismiss for now">
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
