import { useEffect, useState } from 'react'
import TreeCanvas, { DomainLegend } from './components/TreeCanvas'
import EntryConsole from './components/EntryConsole'
import BuddyWidget from './components/BuddyWidget'
import SettingsModal from './components/SettingsModal'
import DomainDrawer from './components/DomainDrawer'
import Onboarding from './components/Onboarding'
import { useTreeState } from './lib/useTreeState'
import { DOMAINS } from './lib/domains'
import { totalTreeXp, treeStage } from './lib/treeEngine'
import { maybeFireReminder } from './lib/notifications'

export default function App() {
  const { state, pending, lastResult, addEntry, updateSettings, renameTree, resetAll, importState } =
    useTreeState()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activeDomain, setActiveDomain] = useState(null)

  useEffect(() => {
    const interval = setInterval(() => {
      maybeFireReminder(state, (date) => updateSettings({ lastReminderDate: date }))
    }, 60_000)
    return () => clearInterval(interval)
  }, [state, updateSettings])

  const total = totalTreeXp(state)
  const stage = treeStage(total)

  if (!state.settings.onboarded) {
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
    <div className="min-h-screen flex flex-col items-center px-4 pt-10 pb-40">
      <header className="text-center mb-2">
        <h1 className="font-display text-3xl">{state.treeName}</h1>
        <p className="text-white/45 text-sm mt-1">
          {stage.name} · {stage.blurb}
        </p>
      </header>

      <TreeCanvas state={state} onSelectDomain={setActiveDomain} />
      <DomainLegend state={state} domains={DOMAINS} onSelectDomain={setActiveDomain} />

      <div className="mt-8 w-full">
        <EntryConsole onSubmit={addEntry} pending={pending} lastResult={lastResult} />
      </div>

      <BuddyWidget state={state} onOpenSettings={() => setSettingsOpen(true)} />

      {settingsOpen && (
        <SettingsModal
          state={state}
          updateSettings={updateSettings}
          renameTree={renameTree}
          resetAll={resetAll}
          importState={importState}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      <DomainDrawer domainId={activeDomain} state={state} onClose={() => setActiveDomain(null)} />
    </div>
  )
}
