import { useRoute } from '@evergrove/kit/router.js'
import Link from '@evergrove/kit/components/Link.jsx'
import JarvisPage from './JarvisPage.jsx'
import JarvisSettings from './JarvisSettings.jsx'
import MemoryScreen from './MemoryScreen.jsx'
import WeeklyScreen from './WeeklyScreen.jsx'

// Jarvis's screens. The chat is the home; the rest are one tap away.
const TABS = [
  ['', 'Chat', '/jarvis'],
  ['weekly', 'Week', '/jarvis/weekly'],
  ['memory', 'Memory', '/jarvis/memory'],
  ['settings', 'Settings', '/jarvis/settings'],
]

export default function JarvisApp() {
  const route = useRoute()
  const sub = route?.sub?.split('/')[0] ?? ''
  const active = TABS.some(([id]) => id === sub) ? sub : ''
  return (
    <div>
      <nav aria-label="Jarvis screens" className="mb-4 flex gap-2">
        {TABS.map(([id, label, path]) => (
          <Link
            key={id || 'chat'}
            to={path}
            aria-current={active === id ? 'page' : undefined}
            className={`px-3 py-1.5 rounded-full text-sm border ${active === id ? 'bg-sky-500/20 border-sky-400/30 text-sky-200' : 'border-white/10 text-white/60 hover:bg-white/5'}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      {active === 'settings' ? <JarvisSettings /> : active === 'weekly' ? <WeeklyScreen /> : active === 'memory' ? <MemoryScreen /> : <JarvisPage />}
    </div>
  )
}
