import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Leaf, Settings, X } from 'lucide-react'
import { DOMAINS } from '@evergrove/core/lib/domains.js'
import { domainTotalXp, todaysEntries, totalTreeXp, treeStage, currentStreak, levelFromXp } from '@evergrove/core/lib/treeEngine.js'

export default function BuddyWidget({ state, onOpenSettings }) {
  const [open, setOpen] = useState(false)
  const total = totalTreeXp(state)
  const stage = treeStage(total)
  const today = todaysEntries(state)
  const streak = currentStreak(state)
  const todayXp = today.reduce(
    (sum, e) => sum + e.updates.reduce((s, u) => s + (u.xpGain || 0), 0),
    0
  )

  return (
    <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-3">
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 260, damping: 22 }}
            className="w-72 rounded-2xl border border-white/10 bg-[#0e1a13]/95 backdrop-blur-xl shadow-2xl p-4"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="font-display text-lg leading-tight">{state.treeName}</p>
                <p className="text-xs text-white/50">
                  {stage.name} · {total} xp total
                </p>
              </div>
              <button
                onClick={onOpenSettings}
                className="p-1.5 rounded-lg hover:bg-white/10 text-white/60"
                aria-label="Settings"
              >
                <Settings size={16} />
              </button>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 text-center">
              <div className="rounded-xl bg-white/5 py-2">
                <p className="text-lg font-semibold">{today.length}</p>
                <p className="text-[11px] text-white/55">logged today</p>
              </div>
              <div className="rounded-xl bg-white/5 py-2">
                <p className="text-lg font-semibold">{streak}</p>
                <p className="text-[11px] text-white/55">day streak</p>
              </div>
            </div>

            {todayXp > 0 && (
              <p className="mt-2 text-xs text-emerald-300/80 text-center">+{todayXp} xp today</p>
            )}

            <div className="mt-3 space-y-1.5">
              {DOMAINS.map((d) => {
                const xp = domainTotalXp(state, d.id)
                const { level, progress } = levelFromXp(xp)
                return (
                  <div key={d.id} className="flex items-center gap-2 text-xs">
                    <span className="w-4 text-center">{d.emoji}</span>
                    <span className="w-24 truncate text-white/60">{d.name.split(' ')[0]}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-white/8 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${xp > 0 ? Math.max(6, progress * 100) : 0}%`, background: d.color }}
                      />
                    </div>
                    <span className="w-6 text-right text-white/55">{xp > 0 ? level : '-'}</span>
                  </div>
                )
              })}
            </div>

            {today.length === 0 && (
              <p className="mt-3 text-xs text-white/55 italic">
                Nothing logged yet today — I'll check back with you later. 🌱
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        onClick={() => setOpen((v) => !v)}
        whileTap={{ scale: 0.92 }}
        className="w-14 h-14 rounded-full bg-emerald-500 shadow-xl grid place-items-center text-emerald-950 animate-float-slow"
        aria-label="Toggle Evergrove buddy"
      >
        {open ? <X size={22} /> : <Leaf size={22} />}
      </motion.button>
    </div>
  )
}
