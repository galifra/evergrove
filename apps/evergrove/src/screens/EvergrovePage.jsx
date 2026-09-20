import { useState } from 'react'
import TreeCanvas, { DomainLegend } from '@evergrove/ui/components/TreeCanvas.jsx'
import EntryConsole from '@evergrove/ui/components/EntryConsole.jsx'
import DomainDrawer from '@evergrove/ui/components/DomainDrawer.jsx'
import TodayCard from '@evergrove/kit/components/TodayCard.jsx'
import { useApp } from '@evergrove/kit/AppContext.jsx'
import { go } from '@evergrove/kit/router.js'
import { DOMAINS } from '@evergrove/core/lib/domains.js'
import { totalTreeXp, treeStage } from '@evergrove/core/lib/treeEngine.js'

export default function EvergrovePage() {
  const { viewState, evState, addEntry, pending, lastResult, run, reverseEvent } = useApp()
  const [activeDomain, setActiveDomain] = useState(null)
  const stage = treeStage(totalTreeXp(viewState))

  return (
    <div className="flex flex-col items-center">
      <header className="text-center mb-2">
        <h1 className="font-display text-3xl">{viewState.treeName}</h1>
        <p className="text-white/55 text-sm mt-1">
          {stage.name} · {stage.blurb}
        </p>
      </header>

      <TreeCanvas state={viewState} onSelectDomain={setActiveDomain} />
      <DomainLegend state={viewState} domains={DOMAINS} onSelectDomain={setActiveDomain} />

      <button onClick={() => go('/timeline')} className="mt-3 text-xs text-white/55 hover:text-white/80 underline">
        See everything that has grown your tree
      </button>

      <TodayCard />

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
