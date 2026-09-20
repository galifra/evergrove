import { useState } from 'react'
import { ThumbsDown, ThumbsUp } from 'lucide-react'
import { feedbackEvent, replyFeedbackData } from '../lib/notes.js'

// A thumb on a reply. It is kept in the log (so it syncs) with the words that led to it, unless
// the reply touched a private app, in which case only the names of the actions are kept. A thumb
// down can say what was off. "Export my feedback" turns these into test cases.
export default function ReplyFeedback({ message, said, privateIds, rated, runtime }) {
  const [asking, setAsking] = useState(false)
  const [what, setWhat] = useState('')
  const [error, setError] = useState('')

  async function record(value, text) {
    setError('')
    try {
      await runtime.log.append(feedbackEvent({ targetKind: 'reply', targetId: message.id, value, text, extra: replyFeedbackData(message, said, privateIds) }))
      setAsking(false)
    } catch {
      setError('Could not save that.')
    }
  }

  if (rated) return <div className="text-[11px] text-white/45">{rated === 'up' ? 'Marked helpful.' : 'Marked not helpful.'}</div>
  if (asking) {
    return (
      <form
        className="flex flex-wrap items-center gap-2 text-xs"
        onSubmit={(e) => {
          e.preventDefault()
          record('down', what)
        }}
      >
        <label htmlFor={`off-${message.id}`} className="text-white/60">What was off? (optional)</label>
        <input id={`off-${message.id}`} value={what} maxLength={300} onChange={(e) => setWhat(e.target.value)} className="px-2 py-1 rounded-md bg-white/5 border border-white/10 min-w-[10rem]" />
        <button type="submit" className="underline text-white/80">Save</button>
        <button type="button" className="underline text-white/50" onClick={() => record('down')}>Skip</button>
        {error && <span role="alert" className="text-rose-300">{error}</span>}
      </form>
    )
  }
  return (
    <div className="flex items-center gap-1 text-white/45">
      <button type="button" aria-label="Good reply" onClick={() => record('up')} className="p-1 rounded hover:bg-white/10 hover:text-white/80"><ThumbsUp size={12} /></button>
      <button type="button" aria-label="Bad reply" onClick={() => setAsking(true)} className="p-1 rounded hover:bg-white/10 hover:text-white/80"><ThumbsDown size={12} /></button>
      {error && <span role="alert" className="text-[11px] text-rose-300">{error}</span>}
    </div>
  )
}
