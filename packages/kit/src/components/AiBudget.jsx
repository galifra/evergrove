import { useEffect, useState } from 'react'
import { getAccessCode } from '@evergrove/core/lib/storage.js'
import { ProgressBar } from '@evergrove/ui/components/ui.jsx'

// The month's AI spending in plain words: how much is used, what it went on, and what the last few
// months looked like. The cap is one number for everything on this address (Jarvis and the tree's
// typed entries share it), and the server enforces it; this only reads it.

const usd = (n, digits = 3) => `$${Number(n).toFixed(digits)}`

export default function AiBudget() {
  const [data, setData] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/usage?history=1', { headers: { 'x-app-code': getAccessCode() } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => alive && setData(d))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [])

  if (failed) return <p className="text-xs text-white/55">The budget can't be read right now. Chat still works; the server enforces the limit either way.</p>
  if (!data) return <p className="text-xs text-white/55">Loading...</p>

  const [now, ...before] = data.months
  const cap = data.capUsd
  const rationAt = data.rationAt ?? 0.8
  const share = now.spentUsd / cap
  const state = share >= 1 ? 'stopped' : share >= rationAt ? 'ration' : 'ok'
  const split = Object.entries(now.byPurpose ?? {}).sort((a, b) => b[1] - a[1])

  return (
    <div className="space-y-3 text-sm">
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-white/80">{usd(now.spentUsd)} of {usd(cap, 2)} this month</span>
          <span className="text-xs text-white/50">{now.requests} request{now.requests === 1 ? '' : 's'}</span>
        </div>
        <div className="relative mt-1.5">
          <ProgressBar value={Math.min(1, share)} color={state === 'ok' ? '#38bdf8' : state === 'ration' ? '#fbbf24' : '#fb7185'} over={state === 'stopped'} />
          <span aria-hidden="true" className="absolute top-0 bottom-0 w-px bg-white/40" style={{ left: `${rationAt * 100}%` }} />
        </div>
        <p className="mt-1.5 text-xs text-white/60">
          {state === 'ok' && `Everything is on. At ${Math.round(rationAt * 100)}% he pauses the optional extras (the weekly write-up and opinions) and keeps the rest of the allowance for chat.`}
          {state === 'ration' && "I'm on a short ration this month: the weekly write-up and opinions are paused so chat lasts. Quick commands and your apps are unaffected."}
          {state === 'stopped' && "This month's allowance is used. Quick commands (undo, brief me, today, remember, forget, the weekly review) and all your apps still work; the AI is back on the 1st."}
        </p>
      </div>

      <div>
        <p className="text-xs text-white/50">What it went on</p>
        {split.length === 0 ? (
          <p className="mt-1 text-xs text-white/55">Nothing yet this month.</p>
        ) : (
          <ul className="mt-1 space-y-0.5 text-xs text-white/70">
            {split.map(([k, v]) => (
              <li key={k} className="flex justify-between gap-3">
                <span>{data.purposeLabels?.[k] ?? k}</span>
                <span>{usd(v)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {before.length > 0 && (
        <div>
          <p className="text-xs text-white/50">Earlier months</p>
          <ul className="mt-1 space-y-0.5 text-xs text-white/70">
            {before.map((m) => (
              <li key={m.month} className="flex justify-between gap-3">
                <span>{m.month}</span>
                <span>
                  {usd(m.spentUsd)} · {m.requests} request{m.requests === 1 ? '' : 's'}
                  {m.avgPerRequestUsd !== null ? ` · ${usd(m.avgPerRequestUsd, 4)} each` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
