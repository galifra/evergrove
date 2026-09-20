import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@evergrove/ui/styles.css'
import { redirectLegacyHash } from '@evergrove/kit/router.js'
import { registerChunkRecovery } from '@evergrove/kit/recover.js'
import AppShell from '@evergrove/kit/AppShell.jsx'
import JarvisApp from './screens/JarvisApp.jsx'

// Jarvis: his own app, his own page-load, his own code. It shares only the
// library and the log with Evergrove.
if (!redirectLegacyHash()) {
  registerChunkRecovery()
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <AppShell showBuddy={false}>
        <JarvisApp />
      </AppShell>
    </StrictMode>,
  )
}
