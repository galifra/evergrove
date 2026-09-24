import { useEffect, useRef, useState } from 'react'
import { MotionConfig } from 'framer-motion'
import { ChevronDown, Settings } from 'lucide-react'
import { HUB, MODULES, TRACKERS } from '@evergrove/rules/routes.js'
import { AppIcon } from '@evergrove/ui/components/ui.jsx'
import BuddyWidget from '@evergrove/ui/components/BuddyWidget.jsx'
import { AppProvider, useApp } from './AppContext.jsx'
import { useRoute } from './router.js'
import Link from './components/Link.jsx'
import SettingsModal from './components/SettingsModal.jsx'
import Onboarding from './components/Onboarding.jsx'

// The frame every app sits in: header with the app switcher, Settings, skip
// link, onboarding for a brand-new browser, and the page title. Because
// onboarding lives here, opening ANY app address on a new device starts setup.

const GROUPS = [
  ['Evergrove', HUB],
  ['Apps', MODULES],
  ['Trackers', TRACKERS],
]

function AppSwitcher({ route }) {
  const [open, setOpen] = useState(false)
  const box = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    const onDown = (e) => box.current && !box.current.contains(e.target) && setOpen(false)
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open])

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm text-white/80 hover:bg-white/5 border border-white/10"
      >
        <span className="w-2 h-2 rounded-full" style={{ background: route?.color ?? '#34d399' }} aria-hidden="true" />
        {route?.name ?? 'Apps'}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <nav aria-label="All apps" className="absolute left-0 mt-2 w-72 max-h-[70vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0e1a13] p-2 shadow-2xl z-40">
          {GROUPS.map(([title, items]) => (
            <div key={title} className="mb-2">
              <div className="px-2 py-1 text-[11px] uppercase tracking-wide text-white/45">{title}</div>
              <ul>
                {items.map((r) => (
                  <li key={r.id}>
                    <Link
                      to={r.path}
                      aria-current={route?.id === r.id ? 'page' : undefined}
                      onClick={() => setOpen(false)}
                      className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-white/5 ${route?.id === r.id ? 'text-emerald-200' : 'text-white/80'}`}
                    >
                      <span className="grid place-items-center w-6 h-6 rounded-md" style={{ background: `${r.color}26`, color: r.color }}>
                        <AppIcon name={r.icon} size={14} />
                      </span>
                      {r.name}
                      {r.private && <span className="ml-auto text-[10px] text-white/40">private</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      )}
    </div>
  )
}

function Frame({ children, showBuddy }) {
  const { ready, bootError, settings, updateSettings, renameTree, viewState } = useApp()
  const route = useRoute()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const first = useRef(true)

  // Each screen gets its own title, and keyboard focus moves to the main area on
  // an in-page move so screen readers announce the new screen.
  const label = route ? (route.custom && route.trackerId ? route.trackerId : route.name) : 'Not found'
  useEffect(() => {
    document.title = route?.id === 'evergrove' ? 'Evergrove' : `${label} · Evergrove`
    if (first.current) first.current = false
    else document.getElementById('main')?.focus()
  }, [label, route?.id])

  if (bootError) {
    return (
      <div className="min-h-screen grid place-items-center p-6 text-center">
        <div>
          <p className="font-display text-xl mb-2">Evergrove can't open its storage</p>
          <p className="text-sm text-white/50 max-w-sm">This browser blocked local storage (private mode can do that). Open Evergrove in a normal window.</p>
        </div>
      </div>
    )
  }
  if (!ready) return <div className="min-h-screen grid place-items-center text-white/55 text-sm">Opening your grove...</div>

  if (!settings.onboarded) {
    return (
      <Onboarding
        onFinish={({ treeName, reminderTime, reminderEnabled }) => {
          renameTree(treeName)
          updateSettings({ reminderTime, reminderEnabled, onboarded: true })
        }}
      />
    )
  }

  return (
    <div className="min-h-screen">
      <button type="button" className="skip-link" onClick={() => document.getElementById('main')?.focus()}>
        Skip to content
      </button>
      <header className="sticky top-0 z-30 backdrop-blur-md bg-[#0b140f]/80 border-b border-white/5">
        <nav aria-label="Main" className="max-w-4xl mx-auto px-4 py-2.5 flex items-center gap-2">
          <Link to="/" className="font-display text-lg mr-1 hidden sm:block hover:text-emerald-200">Evergrove</Link>
          <AppSwitcher route={route} />
          <button onClick={() => setSettingsOpen(true)} className="ml-auto p-2 rounded-full text-white/50 hover:text-white hover:bg-white/5" aria-label="Settings">
            <Settings size={17} />
          </button>
        </nav>
      </header>

      <main id="main" tabIndex={-1} className="max-w-4xl mx-auto px-4 pt-6 pb-32 outline-none">
        {children}
      </main>

      {showBuddy && <BuddyWidget state={viewState} onOpenSettings={() => setSettingsOpen(true)} />}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

export default function AppShell({ children, showBuddy = true }) {
  return (
    <MotionConfig reducedMotion="user">
      <AppProvider>
        <Frame showBuddy={showBuddy}>{children}</Frame>
      </AppProvider>
    </MotionConfig>
  )
}
