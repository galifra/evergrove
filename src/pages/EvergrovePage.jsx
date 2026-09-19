import { useState } from 'react'
import TreeCanvas, { DomainLegend } from '../components/TreeCanvas'
import EntryConsole from '../components/EntryConsole'
import DomainDrawer from '../components/DomainDrawer'
import { useApp } from '../app/AppContext'
import { DOMAINS } from '../lib/domains'
import { totalTreeXp, treeStage } from '../lib/treeEngine'

export default function EvergrovePage() {
  const { viewState, evState, insights, addEntry, pending, lastResult, run, reverseEvent } = useApp()
  const [activeDomain, setActiveDomain] = useState(null)
  const stage = treeStage(totalTreeXp(viewState))

  return (
    <div className="flex flex-col items-center">
      <header className="text-center mb-2">
        <h1 className="font-display text-3xl">{viewState.treeName}</h1>
        <p className="text-white/45 text-sm mt-1">
          {stage.name} · {stage.blurb}
        </p>
      </header>

      <TreeCanvas state={viewState} onSelectDomain={setActiveDomain} />
      <DomainLegend state={viewState} domains={DOMAINS} onSelectDomain={setActiveDomain} />

      {insights.length > 0 && (
        <div className="mt-5 w-full max-w-xl space-y-1.5">
          {insights.map((i) => (
            <div key={i.id} className="text-xs text-white/60 rounded-lg bg-white/[0.04] border border-white/10 px-3 py-2">
              {i.message}
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 w-full">
        <EntryConsole onSubmit={addEntry} pending={pending} lastResult={lastResult} />
      </div>

      <DomainDrawer
        domainId={activeDomain}
        state={viewState}
        paused={evState.paused.includes(activeDomain)}
        onClose={() => setActiveDomain(null)}
        onAddSkill={(area, skill) => run('evergrove__add_skill', { area, skill })}
        onPractice={(area, skill, xp) => run('evergrove__practice_skill', { area, skill, xp })}
        onUndo={reverseEvent}
        onTogglePause={(area, paused) => run(paused ? 'evergrove__resume_area' : 'evergrove__pause_area', { area })}
      />
    </div>
  )
}
