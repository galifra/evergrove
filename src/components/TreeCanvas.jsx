import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { buildTree } from '../lib/treeGeometry'
import { levelFromXp, skillTotalXp } from '../lib/treeEngine'

export default function TreeCanvas({ state, onSelectDomain }) {
  const tree = useMemo(() => buildTree(state), [state])
  const [hovered, setHovered] = useState(null)
  const paused = new Set(state.paused ?? [])

  return (
    <div className="relative w-full max-w-3xl mx-auto select-none">
      <svg
        viewBox={tree.viewBox}
        className="w-full h-auto"
        style={{ filter: 'drop-shadow(0 20px 40px rgba(0,0,0,0.45))' }}
      >
        <defs>
          <radialGradient id="ground-glow" cx="50%" cy="100%" r="60%">
            <stop offset="0%" stopColor="#1c3324" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#0b140f" stopOpacity="0" />
          </radialGradient>
        </defs>

        <ellipse cx="400" cy="645" rx="220" ry="26" fill="url(#ground-glow)" />

        {/* trunk */}
        <motion.line
          x1={tree.trunk.x1}
          y1={tree.trunk.y1}
          initial={{ x2: tree.trunk.x1, y2: tree.trunk.y1, strokeWidth: 0 }}
          animate={{ x2: tree.trunk.x2, y2: tree.trunk.y2, strokeWidth: tree.trunk.width }}
          transition={{ type: 'spring', stiffness: 60, damping: 16 }}
          stroke={tree.trunk.color}
          strokeLinecap="round"
        />

        {/* domain branches */}
        {tree.branches.map((b) => (
          <motion.line
            key={b.key}
            x1={b.x1}
            y1={b.y1}
            initial={{ x2: b.x1, y2: b.y1, strokeWidth: 0 }}
            animate={{ x2: b.x2, y2: b.y2, strokeWidth: b.width, stroke: b.color }}
            transition={{ type: 'spring', stiffness: 55, damping: 15 }}
            strokeLinecap="round"
            opacity={b.dormant ? 0.5 : paused.has(b.domain.id) ? 0.35 : 1}
            onMouseEnter={() => setHovered(b.domain.id)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => onSelectDomain?.(b.domain.id)}
            style={{ cursor: 'pointer' }}
          />
        ))}

        {/* skill twigs */}
        {tree.twigs.map((t) => (
          <motion.line
            key={t.key}
            x1={t.x1}
            y1={t.y1}
            initial={{ x2: t.x1, y2: t.y1, strokeWidth: 0 }}
            animate={{ x2: t.x2, y2: t.y2, strokeWidth: t.width, stroke: t.color }}
            transition={{ type: 'spring', stiffness: 90, damping: 14 }}
            strokeLinecap="round"
            opacity={paused.has(t.domain.id) ? 0.3 : 0.85}
          />
        ))}

        {/* leaves & blossoms */}
        <AnimatePresence>
          {tree.leaves.map((l) => (
            <motion.circle
              key={l.key}
              initial={{ scale: 0, opacity: 0, cx: l.x, cy: l.y }}
              animate={{ scale: 1, opacity: paused.has(l.domainId) ? 0.35 : 1, cx: l.x, cy: l.y }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 14 }}
              r={l.r}
              fill={l.fill}
              stroke={l.bloom ? l.color : 'none'}
              strokeWidth={l.bloom ? 1.5 : 0}
            />
          ))}
        </AnimatePresence>

        {/* invisible larger hit-targets + labels for domains, drawn last so they're on top */}
        {tree.branches.map((b) => (
          <g
            key={`label-${b.key}`}
            onMouseEnter={() => setHovered(b.domain.id)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => onSelectDomain?.(b.domain.id)}
            style={{ cursor: 'pointer' }}
          >
            <circle cx={b.x2} cy={b.y2} r={16} fill="transparent" />
            {hovered === b.domain.id && (
              <text
                x={b.x2}
                y={b.y2 - 22}
                textAnchor="middle"
                fontSize="13"
                fontFamily="Inter, sans-serif"
                fill="#eaf3ec"
              >
                {b.domain.emoji} {b.domain.name}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  )
}

export function DomainLegend({ state, onSelectDomain, domains }) {
  return (
    <div className="flex flex-wrap justify-center gap-2 mt-2">
      {domains.map((d) => {
        const skillCount = Object.keys(state.skills[d.id] || {}).length
        return (
          <button
            key={d.id}
            onClick={() => onSelectDomain(d.id)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
          >
            <span className="w-2 h-2 rounded-full" style={{ background: d.color }} />
            <span className="opacity-80">{d.name}</span>
            {state.paused?.includes(d.id) && <span className="text-[10px] text-white/55">paused</span>}
            <span className="opacity-50">{skillCount ? `${skillCount}` : ''}</span>
          </button>
        )
      })}
    </div>
  )
}

export function skillLevelLabel(skill) {
  const { level } = levelFromXp(skillTotalXp(skill))
  return level
}
