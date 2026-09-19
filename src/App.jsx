import { useState } from 'react'
import { Bot, LayoutGrid, Settings, Trees } from 'lucide-react'
import { AppProvider, useApp } from './app/AppContext'
import { go, useRoute } from './app/router'
import BuddyWidget from './components/BuddyWidget'
import SettingsModal from './components/SettingsModal'
import Onboarding from './components/Onboarding'
import EvergrovePage from './pages/EvergrovePage'
import JarvisPage from './pages/JarvisPage'
import AppsPage from './pages/AppsPage'
import TrackerPage from './pages/TrackerPage'
import TasksPage from './pages/TasksPage'
import CalendarPage from './pages/CalendarPage'
import MoneyPage from './pages/MoneyPage'
import GoalsPage from './pages/GoalsPage'
import PeoplePage from './pages/PeoplePage'
import VaultPage from './pages/VaultPage'

const MODULE_PAGES = {
  tasks: TasksPage,
  calendar: CalendarPage,
  money: MoneyPage,
  goals: GoalsPage,
  people: PeoplePage,
  vault: VaultPage,
}

function NavLink({ to, active, icon: Icon, children }) {
  return (
    <button
      onClick={() => go(to)}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-colors ${
        active ? 'bg-emerald-500/20 text-emerald-200' : 'text-white/60 hover:text-white hover:bg-white/5'
      }`}
    >
      <Icon size={15} /> {children}
    </button>
  )
}

function Page({ route }) {
  if (route.name === 'jarvis') return <JarvisPage />
  if (route.name === 'apps') return <AppsPage />
  if (route.name === 'app' && route.param) {
    const Module = MODULE_PAGES[route.param]
    return Module ? <Module /> : <TrackerPage trackerId={route.param} />
  }
  return <EvergrovePage />
}

function Shell() {
  const { ready, bootError, settings, updateSettings, renameTree, viewState } = useApp()
  const route = useRoute()
  const [settingsOpen, setSettingsOpen] = useState(false)

  if (bootError) {
    return (
      <div className="min-h-screen grid place-items-center p-6 text-center">
        <div>
          <p className="font-display text-xl mb-2">Evergrove can't open its storage</p>
          <p className="text-sm text-white/50 max-w-sm">
            This browser blocked local storage (private mode can do that). Open Evergrove in a normal window.
          </p>
        </div>
      </div>
    )
  }
  if (!ready) return <div className="min-h-screen grid place-items-center text-white/40 text-sm">Opening your grove...</div>

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
      <header className="sticky top-0 z-30 backdrop-blur-md bg-[#0b140f]/80 border-b border-white/5">
        <nav className="max-w-4xl mx-auto px-4 py-2.5 flex items-center gap-1">
          <span className="font-display text-lg mr-3 hidden sm:block">Evergrove</span>
          <NavLink to="/" active={route.name === 'home'} icon={Trees}>Tree</NavLink>
          <NavLink to="/jarvis" active={route.name === 'jarvis'} icon={Bot}>Jarvis</NavLink>
          <NavLink to="/apps" active={route.name === 'apps' || route.name === 'app'} icon={LayoutGrid}>Apps</NavLink>
          <button onClick={() => setSettingsOpen(true)} className="ml-auto p-2 rounded-full text-white/50 hover:text-white hover:bg-white/5" aria-label="Settings">
            <Settings size={17} />
          </button>
        </nav>
      </header>

      <main className="max-w-4xl mx-auto px-4 pt-6 pb-32">
        <Page route={route} />
      </main>

      {route.name !== 'jarvis' && <BuddyWidget state={viewState} onOpenSettings={() => setSettingsOpen(true)} />}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}
