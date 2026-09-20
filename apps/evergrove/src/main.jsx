import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import '@evergrove/ui/styles.css'
import { redirectLegacyHash, useRoute } from '@evergrove/kit/router.js'
import { registerChunkRecovery } from '@evergrove/kit/recover.js'
import AppShell from '@evergrove/kit/AppShell.jsx'
import Link from '@evergrove/kit/components/Link.jsx'

// The mother app. One page-load per app address; each loads only its own screen.
const SCREENS = {
  evergrove: lazy(() => import('./screens/EvergrovePage.jsx')),
  apps: lazy(() => import('./screens/AppsPage.jsx')),
  log: lazy(() => import('./screens/LogPage.jsx')),
  tasks: lazy(() => import('./screens/TasksPage.jsx')),
  calendar: lazy(() => import('./screens/CalendarPage.jsx')),
  money: lazy(() => import('./screens/MoneyPage.jsx')),
  goals: lazy(() => import('./screens/GoalsPage.jsx')),
  people: lazy(() => import('./screens/PeoplePage.jsx')),
  vault: lazy(() => import('./screens/VaultPage.jsx')),
}
const TrackerPage = lazy(() => import('./screens/TrackerPage.jsx'))

function NotFound() {
  return (
    <div className="text-center py-16">
      <p className="font-display text-2xl mb-2">Nothing here</p>
      <p className="text-sm text-white/55 mb-4">That address isn't one of your apps.</p>
      <Link to="/" className="underline text-emerald-200">Back to Evergrove</Link>
    </div>
  )
}

function Screen() {
  const route = useRoute()
  if (!route) return <NotFound />
  if (route.kind === 'tracker') return route.trackerId ? <TrackerPage trackerId={route.trackerId} /> : <NotFound />
  const Page = SCREENS[route.id]
  return Page ? <Page /> : <NotFound />
}

if (!redirectLegacyHash()) {
  registerChunkRecovery()
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <AppShell>
        <Suspense fallback={<div className="text-white/55 text-sm py-8">Loading...</div>}>
          <Screen />
        </Suspense>
      </AppShell>
    </StrictMode>,
  )
}
