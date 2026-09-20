import { useState } from 'react'
import { setAccessCode } from '../lib/storage'
import {
  Archive, Briefcase, Brain, Calendar, CheckSquare, Compass, Dumbbell, GraduationCap, HeartPulse, House, Lock,
  Palette, Plane, Rocket, Sparkles, Target, Trees, Users, Wallet, LayoutGrid,
} from 'lucide-react'

const ICONS = {
  archive: Archive, briefcase: Briefcase, brain: Brain, calendar: Calendar, 'check-square': CheckSquare,
  compass: Compass, dumbbell: Dumbbell, 'graduation-cap': GraduationCap, 'heart-pulse': HeartPulse,
  home: House, lock: Lock, palette: Palette, plane: Plane, rocket: Rocket, sparkles: Sparkles, target: Target,
  trees: Trees, users: Users, wallet: Wallet,
}

export function AppIcon({ name, size = 18, className = '' }) {
  const Icon = ICONS[name] ?? LayoutGrid
  return <Icon size={size} className={className} aria-hidden="true" />
}

export function PageHeader({ icon, title, subtitle, right }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-5">
      <div className="flex items-start gap-3 min-w-0">
        <div className="mt-1 grid place-items-center w-9 h-9 rounded-xl bg-emerald-500/15 text-emerald-300 shrink-0">
          <AppIcon name={icon} />
        </div>
        <div className="min-w-0">
          <h1 className="font-display text-2xl leading-tight">{title}</h1>
          {subtitle && <p className="text-sm text-white/50 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  )
}

export function Card({ title, children, className = '', right }) {
  return (
    <section className={`rounded-2xl bg-white/[0.04] border border-white/10 p-4 ${className}`}>
      {(title || right) && (
        <div className="flex items-center justify-between mb-3">
          {title && <h2 className="text-sm font-medium text-white/70">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  )
}

const inputCls =
  'w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm placeholder:text-white/30 focus:outline-none focus:border-emerald-400/50'

export function Field({ label, children }) {
  return (
    <label className="block min-w-0">
      <span className="text-xs text-white/50">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}

export const TextInput = (props) => <input {...props} className={`${inputCls} ${props.className ?? ''}`} />
export const Select = ({ options, ...props }) => (
  <select {...props} className={`${inputCls} ${props.className ?? ''}`}>
    {options.map((o) => {
      const value = typeof o === 'string' ? o : o.value
      const label = typeof o === 'string' ? o : o.label
      return (
        <option key={value} value={value} className="bg-[#0e1a13]">
          {label}
        </option>
      )
    })}
  </select>
)

export function Button({ variant = 'primary', className = '', ...props }) {
  const styles = {
    primary: 'bg-emerald-500 hover:bg-emerald-400 text-emerald-950 disabled:opacity-40',
    ghost: 'bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 disabled:opacity-40',
    danger: 'border border-rose-400/25 text-rose-300 hover:bg-rose-500/10 disabled:opacity-40',
  }
  return (
    <button
      type="button"
      {...props}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${styles[variant]} ${className}`}
    />
  )
}

export function ErrorNote({ children }) {
  return children ? <p role="alert" className="text-sm text-rose-300 mt-2">{children}</p> : null
}

export function Empty({ children }) {
  return <p className="text-sm text-white/55 italic">{children}</p>
}

export function ProgressBar({ value, color = '#4ade80', over = false }) {
  return (
    <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
      <div
        className="h-full rounded-full"
        style={{ width: `${Math.min(100, Math.max(0, value * 100))}%`, background: over ? '#fb7185' : color }}
      />
    </div>
  )
}

// Shown when the server says the access code is missing or wrong, so the fix is
// one paste away instead of a trip through Settings.
export function AccessCodePrompt({ onSaved }) {
  const [code, setCode] = useState('')
  return (
    <form
      className="mt-2 flex gap-2 items-center"
      onSubmit={(e) => {
        e.preventDefault()
        setAccessCode(code.trim())
        onSaved?.()
      }}
    >
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Paste your access code"
        autoComplete="off"
        className={inputCls + ' max-w-xs'}
      />
      <Button type="submit" disabled={!code.trim()}>
        Save
      </Button>
    </form>
  )
}
