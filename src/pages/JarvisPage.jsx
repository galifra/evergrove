import { useEffect, useRef, useState } from 'react'
import { Bot, Check, Loader2, Send, Undo2, X } from 'lucide-react'
import { useApp } from '../app/AppContext'
import { newId } from '../core/events'
import { approveStep, askJarvis, buildRequest, planFromContent, runAutoSteps } from '../jarvis/jarvis'
import { getAccessCode } from '../lib/storage'
import { describeLocal } from '../modules/calendar'
import { Button, Empty, PageHeader } from '../components/ui'

const CHAT_KEY = 'evergrove_jarvis_chat_v1'

function loadChat() {
  try {
    return JSON.parse(localStorage.getItem(CHAT_KEY) || '[]')
  } catch {
    return []
  }
}

const STATUS_LABEL = {
  done: 'Done',
  error: 'Could not do it',
  'needs-approval': 'Needs your OK',
  'suggest-only': 'Suggestion only',
  skipped: 'Skipped',
  undone: 'Undone',
  pending: '...',
}

const DATE_LIKE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/
const show = (v) => (typeof v === 'string' && DATE_LIKE.test(v) ? `${v} (${describeLocal(v)})` : typeof v === 'object' ? JSON.stringify(v) : v)
const prettyArgs = (args) =>
  Object.entries(args)
    .map(([k, v]) => `${k}: ${show(v)}`)
    .join(' · ')

export default function JarvisPage() {
  const { runtime, events, settings } = useApp()
  const [messages, setMessages] = useState(loadChat)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [spend, setSpend] = useState(null)
  const bottom = useRef(null)

  useEffect(() => {
    try {
      localStorage.setItem(CHAT_KEY, JSON.stringify(messages.slice(-40)))
    } catch {
      // chat history is a convenience; losing it is fine
    }
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  useEffect(() => {
    fetch('/api/usage', { headers: { 'x-app-code': getAccessCode() } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setSpend(d))
      .catch(() => {})
  }, [])

  const patchStep = (msgId, stepId, patch) =>
    setMessages((ms) =>
      ms.map((m) => (m.id === msgId ? { ...m, steps: m.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)) } : m))
    )

  async function send(e) {
    e.preventDefault()
    const value = text.trim()
    if (!value || busy) return
    setText('')
    setError('')
    setBusy(true)
    const history = [...messages, { id: newId(), role: 'user', text: value }]
    setMessages(history)
    try {
      const forModel = history.map((m) =>
        m.role === 'assistant' ? { role: 'assistant', text: m.memo || m.text || '(waiting for your approval)' } : m
      )
      const payload = buildRequest({ history: forModel, registry: runtime.registry, events, shareSensitive: settings.shareSensitive })
      const reply = await askJarvis(payload)
      if (reply.spend) setSpend(reply.spend)
      const plan = planFromContent(reply.content, runtime.registry)
      const correlationId = newId()
      await runAutoSteps(plan.steps, runtime.registry, correlationId)
      const done = plan.steps.filter((s) => s.status === 'done').map((s) => s.result)
      const modelText = plan.text || (plan.steps.length ? '' : "I'm not sure what to do with that. Can you say it another way?")
      setMessages((ms) => [
        ...ms,
        {
          id: newId(),
          role: 'assistant',
          text: modelText,
          // history for the next turn includes what actually ran, so follow-ups make sense
          memo: [modelText, done.length ? `(Done: ${done.join(' ')})` : ''].filter(Boolean).join(' '),
          correlationId,
          steps: plan.steps,
        },
      ])
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function approve(msg, step) {
    await approveStep(step, runtime.registry, msg.correlationId)
    patchStep(msg.id, step.id, { status: step.status, result: step.result, commandId: step.commandId })
  }

  async function undo(msg, step) {
    const r = await runtime.registry.undo(step.commandId)
    patchStep(msg.id, step.id, r.status === 'done' ? { status: 'undone', result: r.summary, commandId: null } : { result: r.error })
  }

  return (
    <div className="flex flex-col" style={{ minHeight: 'calc(100vh - 8rem)' }}>
      <PageHeader
        icon="trees"
        title="Jarvis"
        subtitle="Say what you did or what you need. I'll use the right apps and ask before anything that matters."
        right={
          <div className="text-right text-xs text-white/40 shrink-0">
            {spend && (
              <>
                AI this month
                <div className="text-white/60">${spend.spentUsd.toFixed(3)} of ${spend.capUsd.toFixed(2)}</div>
              </>
            )}
            {messages.length > 0 && (
              <button onClick={() => setMessages([])} className="mt-1 underline hover:text-white/70">Clear chat</button>
            )}
          </div>
        }
      />

      <div className="flex-1 space-y-3 pb-4">
        {messages.length === 0 && (
          <Empty>
            Try: "ran 30 minutes and read 20 pages", "add dentist Friday 3pm", "I spent $12 on lunch", or "make me a tracker for houseplants".
          </Empty>
        )}
        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-emerald-500/20 border border-emerald-400/20 px-4 py-2 text-sm">{m.text}</div>
            </div>
          ) : (
            <div key={m.id} className="flex gap-2">
              <span className="mt-1 grid place-items-center w-7 h-7 rounded-full bg-white/10 shrink-0"><Bot size={14} /></span>
              <div className="max-w-[90%] space-y-2">
                {m.text && <div className="rounded-2xl rounded-bl-md bg-white/[0.06] border border-white/10 px-4 py-2 text-sm">{m.text}</div>}
                {m.steps?.map((s) => (
                  <div key={s.id} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs text-white/40">{s.moduleName} · {s.name.split('__')[1].replaceAll('_', ' ')}</div>
                        <div className="text-white/70 text-xs break-words">{prettyArgs(s.args)}</div>
                      </div>
                      <span className={`text-xs shrink-0 ${s.status === 'done' ? 'text-emerald-300' : s.status === 'error' ? 'text-rose-300' : 'text-amber-200'}`}>
                        {STATUS_LABEL[s.status] ?? s.status}
                      </span>
                    </div>
                    {s.result && <div className="mt-1 text-white/80">{s.result}</div>}
                    {s.status === 'needs-approval' && (
                      <div className="mt-2 flex gap-2">
                        <Button onClick={() => approve(m, s)}><Check size={13} className="inline mr-1" />Do it</Button>
                        <Button variant="ghost" onClick={() => patchStep(m.id, s.id, { status: 'skipped' })}><X size={13} className="inline mr-1" />Skip</Button>
                      </div>
                    )}
                    {s.status === 'done' && s.commandId && (
                      <div className="mt-2"><Button variant="ghost" onClick={() => undo(m, s)}><Undo2 size={13} className="inline mr-1" />Undo</Button></div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        )}
        {busy && <div className="text-sm text-white/40 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Thinking...</div>}
        {error && <div className="text-sm text-rose-300">{error}</div>}
        <div ref={bottom} />
      </div>

      <form onSubmit={send} className="sticky bottom-20 flex gap-2 items-end bg-[#0b140f]/90 backdrop-blur py-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send(e)
            }
          }}
          rows={2}
          placeholder="Talk to Jarvis..."
          className="flex-1 resize-none rounded-2xl bg-white/[0.05] border border-white/10 px-4 py-3 text-[15px] placeholder:text-white/30 focus:outline-none focus:border-emerald-400/50"
        />
        <Button type="submit" disabled={busy || !text.trim()} className="h-11 w-11 grid place-items-center !p-0 rounded-full" aria-label="Send">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </Button>
      </form>
    </div>
  )
}
