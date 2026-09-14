import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Loader2, Send, Sparkles } from 'lucide-react'

export default function EntryConsole({ onSubmit, pending, lastResult }) {
  const [text, setText] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!text.trim() || pending) return
    const value = text
    setText('')
    await onSubmit(value)
  }

  return (
    <div className="w-full max-w-xl mx-auto">
      <form onSubmit={handleSubmit} className="relative">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSubmit(e)
            }
          }}
          placeholder="What did you just do? e.g. “ran 3 miles, read 20 pages, called mom”"
          rows={2}
          disabled={pending}
          className="w-full resize-none rounded-2xl bg-white/[0.04] border border-white/10 px-4 py-3 pr-12 text-[15px] placeholder:text-white/35 focus:outline-none focus:border-emerald-400/50 focus:bg-white/[0.06] transition-colors"
        />
        <button
          type="submit"
          disabled={pending || !text.trim()}
          className="absolute right-2.5 bottom-2.5 grid place-items-center w-9 h-9 rounded-full bg-emerald-500/90 hover:bg-emerald-400 disabled:opacity-30 disabled:hover:bg-emerald-500/90 transition-colors"
          aria-label="Log it"
        >
          {pending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </form>

      <AnimatePresence mode="wait">
        {lastResult && (
          <motion.div
            key={lastResult.summary || lastResult.error || 'result'}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-3 text-sm rounded-xl px-4 py-3 border"
            style={{
              borderColor: lastResult.error ? 'rgba(251,113,133,0.35)' : 'rgba(74,222,128,0.25)',
              background: lastResult.error ? 'rgba(251,113,133,0.08)' : 'rgba(74,222,128,0.06)',
            }}
          >
            {lastResult.error ? (
              <p className="text-rose-300">{lastResult.error}</p>
            ) : (
              <>
                <p className="text-white/85">{lastResult.summary}</p>
                {lastResult.updates?.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-white/50">
                    {lastResult.updates.map((u, i) => (
                      <li key={i}>
                        +{u.xpGain} xp · {u.skillName}
                      </li>
                    ))}
                  </ul>
                )}
                {lastResult.levelUps?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {lastResult.levelUps.map((lu, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-400/15 text-amber-200 border border-amber-300/25"
                      >
                        <Sparkles size={12} /> {lu.skillName} reached level {lu.level}
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
