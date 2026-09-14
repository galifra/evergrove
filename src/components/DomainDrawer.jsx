import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { domainById } from '../lib/domains'
import { levelFromXp, skillTotalXp } from '../lib/treeEngine'

export default function DomainDrawer({ domainId, state, onClose }) {
  const domain = domainId ? domainById(domainId) : null
  const skills = domain ? Object.values(state.skills[domainId] || {}) : []
  const sorted = [...skills].sort((a, b) => skillTotalXp(b) - skillTotalXp(a))

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
              <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10">
                <X size={18} />
              </button>
            </div>
            <p className="text-white/40 text-xs mb-5">
              {sorted.length} skill{sorted.length === 1 ? '' : 's'} growing here
            </p>

            {sorted.length === 0 && (
              <p className="text-sm text-white/50 italic">
                Nothing here yet. Log something in this area and it'll sprout its own branch.
              </p>
            )}

            <div className="space-y-3">
              {sorted.map((skill) => {
                const { level, progress, xpForNext } = levelFromXp(skillTotalXp(skill))
                return (
                  <div key={skill.id} className="rounded-xl bg-white/5 border border-white/10 p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{skill.name}</span>
                      <span
                        className="text-xs px-2 py-0.5 rounded-full"
                        style={{ background: `${domain.color}22`, color: domain.glow }}
                      >
                        Lv {level}
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 rounded-full bg-white/8 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${Math.max(4, progress * 100)}%`, background: domain.color }}
                      />
                    </div>
                    <p className="mt-1 text-[11px] text-white/35">
                      {skillTotalXp(skill)} xp · {xpForNext} to next level
                    </p>
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
