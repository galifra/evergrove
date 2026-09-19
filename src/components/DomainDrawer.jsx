import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Pause, Play, Plus, X } from 'lucide-react'
import { domainById } from '../lib/domains'
import { levelFromXp, skillTotalXp } from '../lib/treeEngine'

export default function DomainDrawer({ domainId, state, paused, onClose, onAddSkill, onPractice, onTogglePause }) {
  const domain = domainId ? domainById(domainId) : null
  const skills = domain ? Object.values(state.skills[domainId] || {}) : []
  const sorted = [...skills].sort((a, b) => skillTotalXp(b) - skillTotalXp(a))
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  async function add(e) {
    e.preventDefault()
    setError('')
    const r = await onAddSkill(domainId, name.trim())
    if (r.status === 'error') setError(r.error)
    else setName('')
  }

  return (
    <AnimatePresence>
      {domain && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ x: 360 }}
            animate={{ x: 0 }}
            exit={{ x: 360 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="w-full max-w-sm h-full bg-[#0e1a13] border-l border-white/10 p-5 overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-1">
              <h2 className="font-display text-2xl flex items-center gap-2">
                <span>{domain.emoji}</span> {domain.name}
              </h2>
              <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10" aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <div className="flex items-center justify-between mb-5">
              <p className="text-white/40 text-xs">
                {sorted.length} skill{sorted.length === 1 ? '' : 's'} growing here{paused ? ' · paused' : ''}
              </p>
              <button
                onClick={() => onTogglePause(domainId, paused)}
                className="text-xs flex items-center gap-1 text-white/50 hover:text-white/80"
              >
                {paused ? <Play size={12} /> : <Pause size={12} />} {paused ? 'Resume' : 'Pause area'}
              </button>
            </div>

            <form onSubmit={add} className="flex gap-2 mb-1">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Plant a new skill..."
                className="flex-1 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm placeholder:text-white/30 focus:outline-none focus:border-emerald-400/50"
              />
              <button
                type="submit"
                disabled={!name.trim()}
                className="px-3 rounded-lg bg-emerald-500 text-emerald-950 disabled:opacity-40"
                aria-label="Add skill"
              >
                <Plus size={16} />
              </button>
            </form>
            {error && <p className="text-xs text-rose-300 mb-3">{error}</p>}

            {sorted.length === 0 && (
              <p className="text-sm text-white/50 italic mt-4">
                Nothing here yet. Plant a skill above, or log something in this area and it'll sprout its own branch.
              </p>
            )}

            <div className="space-y-3 mt-4">
              {sorted.map((skill) => {
                const { level, progress, xpForNext } = levelFromXp(skillTotalXp(skill))
                return (
                  <div key={skill.id} className="rounded-xl bg-white/5 border border-white/10 p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{skill.name}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: `${domain.color}22`, color: domain.glow }}>
                        Lv {level}
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.max(4, progress * 100)}%`, background: domain.color }} />
                    </div>
                    <div className="mt-1.5 flex items-center justify-between">
                      <p className="text-[11px] text-white/35">
                        {skillTotalXp(skill)} xp · {xpForNext} to next level
                      </p>
                      <div className="flex gap-1.5">
                        {[5, 15].map((xp) => (
                          <button
                            key={xp}
                            onClick={() => onPractice(domainId, skill.name, xp)}
                            className="text-[11px] px-2 py-0.5 rounded-md bg-white/5 hover:bg-white/10 border border-white/10"
                          >
                            +{xp}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
