import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Check, Headphones, Loader2, Mic, Send, Square, Undo2, X } from 'lucide-react'
import { useApp } from '@evergrove/kit/AppContext.jsx'
import { go, useRoute } from '@evergrove/kit/router.js'
import { appPath } from '@evergrove/rules/routes.js'
import { composeBriefing } from '@evergrove/rules/briefing.js'
import { deriveToday } from '@evergrove/rules/today.js'
import { HELP_TEXT, matchLocalIntent } from '../lib/localIntents'
import { newId } from '@evergrove/core/events.js'
import { approveStep, askJarvis, buildRequest, contextSources, memoriesFor, needsEscalation, planFromContent, runAutoSteps } from '../lib/jarvis'
import { getAccessCode } from '@evergrove/core/lib/storage.js'
import { speechSupported, startListening } from '@evergrove/kit/lib/speech.js'
import { describeLocal } from '@evergrove/modules/calendar.js'
import { AccessCodePrompt, Button, Empty, PageHeader } from '@evergrove/ui/components/ui.jsx'
import TodayCard from '@evergrove/kit/components/TodayCard.jsx'
import Link from '@evergrove/kit/components/Link.jsx'
import { greeting, stepLink } from '../lib/home'
import { feedbackState } from '@evergrove/rules/observations.js'
import { composeWeekly } from '@evergrove/rules/weekly.js'
import { buildOpinionRequest, exportFeedback } from '../lib/notes'
import JarvisNotes from './JarvisNotes.jsx'
import ReplyFeedback from './ReplyFeedback.jsx'
import { replyFor } from '../lib/replies'
import { RATION_TEXT } from '../lib/ration'
import { speak, speakableReply, speechOutSupported, stopSpeaking } from '../lib/speak'
import { listApps } from '@evergrove/rules/registry.js'
import { deriveMemory, findNotes, nameNote } from '@evergrove/modules/memory.js'

const CHAT_KEY = 'evergrove_jarvis_chat_v1'

// Outside the component so a remount (React dev mode does this on purpose) can't post the briefing twice.
let lastLandingAt = 0

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
  const { runtime, events, settings, updateSettings } = useApp()
  const route = useRoute()
  const briefed = useRef(false)
  const [messages, setMessages] = useState(loadChat)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [needsCode, setNeedsCode] = useState(false)
  const [seen, setSeen] = useState(null)
  const [copiedSent, setCopiedSent] = useState(false)
  const [listening, setListening] = useState(false)
  const [voiceError, setVoiceError] = useState('')
  const stopVoice = useRef(null)
  // A real back-and-forth: the mic reopens on its own after Jarvis finishes speaking, so nothing
  // needs to be tapped between turns. Free (the same browser mic and browser voice), just looped.
  const [conversing, setConversing] = useState(false)
  const convoRef = useRef(false)
  const heardRef = useRef('')
  const missesRef = useRef(0)
  const [nameDraft, setNameDraft] = useState('')
  const lastMemory = useRef(null) // the note saved most recently in this chat, for "forget that"
  const [spend, setSpend] = useState(null)
  const [speaking, setSpeaking] = useState(false)
  const bottom = useRef(null)
  const myName = deriveMemory(events).name
  const privateIds = useMemo(() => new Set(listApps(events).filter((a) => a.sensitive).map((a) => a.id)), [events])
  const repliesRated = useMemo(() => {
    const out = new Map()
    for (const r of feedbackState(events).ratings) if (r.targetKind === 'reply') out.set(r.targetId, r.value)
    return out
  }, [events])
  const persona = { style: settings.jarvisStyle, title: settings.jarvisTitle }

  // Spoken replies (off by default). Private details are only read aloud when that app is shared.
  function sayAloud(message) {
    // In a conversation, listening resumes once he's done talking, whether or not he actually
    // said anything out loud (speaking could be off, or there was nothing to say).
    if (!settings.speakReplies || !speechOutSupported()) return advanceConversation()
    const line = speakableReply(message, { privateIds, shared: settings.shareSensitive })
    if (!line) return advanceConversation()
    const started = speak(line, {
      voiceURI: settings.voiceURI,
      rate: settings.speechRate,
      onEnd: () => {
        setSpeaking(false)
        advanceConversation()
      },
    })
    if (started) setSpeaking(true)
    else advanceConversation()
  }

  // Waits a beat (so the mic doesn't catch the tail end of his own voice) and starts listening again.
  function advanceConversation() {
    if (!convoRef.current) return
    setTimeout(() => {
      if (convoRef.current) listenOnce()
    }, 350)
  }

  // One turn of listening: what you say becomes the next message, sent the moment you stop talking.
  function listenOnce() {
    if (!speechSupported()) return
    setVoiceError('')
    heardRef.current = ''
    setListening(true)
    try {
      stopVoice.current = startListening({
        onText: (text, final) => {
          if (final) heardRef.current = text
        },
        onEnd: () => {
          setListening(false)
          const said = heardRef.current.trim()
          if (said) {
            missesRef.current = 0
            sendText(said)
          } else if (convoRef.current) {
            // Nothing heard. Try again, but not forever — after two quiet turns in a row, pause and say why.
            missesRef.current += 1
            if (missesRef.current >= 2) {
              endConversation()
              setMessages((ms) => [...ms, say('assistant', "I paused our conversation — I didn't hear anything for a bit. Tap the headphones to start again.")])
            } else {
              advanceConversation()
            }
          }
        },
        onError: (message) => {
          setListening(false)
          setVoiceError(message)
          endConversation()
        },
      })
    } catch {
      setListening(false)
      setVoiceError('Voice input could not start in this browser.')
      endConversation()
    }
  }

  function startConversation() {
    if (!speechSupported()) return
    if (!settings.speakReplies) updateSettings({ speakReplies: true })
    missesRef.current = 0
    convoRef.current = true
    setConversing(true)
    listenOnce()
  }

  function endConversation() {
    convoRef.current = false
    setConversing(false)
    stopVoice.current?.()
    stopSpeaking()
    setSpeaking(false)
    setListening(false)
  }

  useEffect(() => {
    try {
      localStorage.setItem(CHAT_KEY, JSON.stringify(messages.slice(-40)))
    } catch {
      // chat history is a convenience; losing it is fine
    }
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  // A reply worked out on the device (today's list, a note saved, a briefing) is read aloud too, once,
  // when spoken replies are on. What was already in the chat when it opened is never read out.
  const spokenIds = useRef(new Set(messages.map((m) => m.id)))
  useEffect(() => {
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'assistant' || !last.local || spokenIds.current.has(last.id)) return
    spokenIds.current.add(last.id)
    sayAloud({ text: last.text, steps: [], private: last.private })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages])

  useEffect(() => {
    fetch('/api/usage', { headers: { 'x-app-code': getAccessCode() } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setSpend(d))
      .catch(() => {})
  }, [])

  // Leaving Jarvis (a tab, or the page) ends a live conversation instead of leaving the mic running.
  useEffect(() => () => endConversation(), [])

  // Once a month, when the allowance runs short, he says so in the chat instead of letting things fail quietly.
  useEffect(() => {
    if (!spend?.month || !(spend.rationed || spend.stopped)) return
    const key = `evergrove_jarvis_ration_notice_${spend.month}_${spend.stopped ? 'stopped' : 'ration'}`
    try {
      if (localStorage.getItem(key)) return
      localStorage.setItem(key, '1')
    } catch {
      return
    }
    setMessages((ms) => [...ms, say('assistant', spend.stopped ? RATION_TEXT.stopped : RATION_TEXT.ration)])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spend?.month, spend?.rationed, spend?.stopped])

  const patchStep = (msgId, stepId, patch) =>
    setMessages((ms) =>
      ms.map((m) => (m.id === msgId ? { ...m, steps: m.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)) } : m))
    )

  // `local` marks a reply worked out on the device, which the effect above reads aloud (when that is on).
  const say = (role, body, extra = {}) => ({ id: newId(), role, text: body, memo: role === 'assistant' ? body.split('\n')[0] : undefined, steps: [], local: true, ...extra })

  // Exact, simple commands are handled right here: instant, free, offline.
  async function handleLocal(intent, value) {
    if (intent.type === 'clear') return setMessages([])
    setMessages((ms) => [...ms, { id: newId(), role: 'user', text: value }])
    if (intent.type === 'briefing') return postBriefing()
    if (intent.type === 'help') return setMessages((ms) => [...ms, say('assistant', HELP_TEXT)])
    if (intent.type === 'weekly') {
      const review = composeWeekly(runtime.log.getEvents(), new Date())
      return setMessages((ms) => [...ms, say('assistant', review.text, { link: { path: '/jarvis/weekly', label: 'your week' }, private: true })])
    }
    if (intent.type === 'exportfeedback') {
      const data = exportFeedback(runtime.log.getEvents())
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `jarvis-feedback-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      return setMessages((ms) => [...ms, say('assistant', `Saved ${data.cases.length} rated repl${data.cases.length === 1 ? 'y' : 'ies'} and your ratings of my notes to a file. Replies about private apps carry only the action names.`)])
    }
    if (intent.type === 'opinion') return askOpinion(intent.topic)
    if (intent.type === 'remember') {
      const r = await runtime.registry.invoke('memory__remember', { text: intent.text.slice(0, 240), via: 'command' }, { approved: true, actor: 'user' })
      if (r.status === 'done') lastMemory.current = deriveMemory(runtime.log.getEvents()).notes.find((n) => n.text === intent.text.trim().replace(/\s+/g, ' '))?.text ?? null
      return setMessages((ms) => [...ms, say('assistant', r.status === 'done' ? r.summary : r.error, { private: /\(private\)/.test(r.summary ?? ''), link: r.status === 'done' ? { path: '/jarvis/memory', label: 'what I remember' } : undefined })])
    }
    if (intent.type === 'callme') {
      const r = await runtime.registry.invoke('memory__remember', { text: nameNote(intent.name), role: 'name', category: 'fact', private: false, via: 'command' }, { approved: true, actor: 'user' })
      return setMessages((ms) => [...ms, say('assistant', r.status === 'done' ? `${intent.name} it is.` : r.error)])
    }
    if (intent.type === 'memories') {
      const { notes } = deriveMemory(runtime.log.getEvents())
      const open = notes.filter((n) => !n.private)
      const body = notes.length
        ? `I have ${notes.length} note${notes.length === 1 ? '' : 's'}${notes.length > open.length ? ` (${notes.length - open.length} private)` : ''}.${open.length ? `\n${open.slice(-6).map((n) => '- ' + n.text).join('\n')}` : ''}`
        : "I haven't noted anything yet. Say \"remember that ...\" and I will."
      return setMessages((ms) => [...ms, say('assistant', body, { link: { path: '/jarvis/memory', label: 'all my notes' } })])
    }
    if (intent.type === 'forget') {
      const { notes } = deriveMemory(runtime.log.getEvents())
      const matches = intent.last ? notes.filter((n) => n.text === lastMemory.current) : findNotes(notes, intent.query)
      if (matches.length === 0) {
        const body = intent.last ? "I haven't saved anything in this chat. Tell me what to forget, or open my notes." : 'I have no note about that.'
        return setMessages((ms) => [...ms, say('assistant', body, { link: { path: '/jarvis/memory', label: 'my notes' } })])
      }
      if (matches.length > 1) {
        const shown = matches.slice(0, 5).map((n) => '- ' + (n.private ? '(private note)' : n.text)).join('\n')
        return setMessages((ms) => [...ms, say('assistant', `Which one?\n${shown}\nSay more of its words.`)])
      }
      const step = { id: newId(), name: 'memory__forget', args: { note: matches[0].text }, tier: 'ask', moduleName: 'Memory', description: 'Forget a note', status: 'needs-approval' }
      return setMessages((ms) => [...ms, say('assistant', `Forget this note? "${matches[0].private ? 'a private note' : matches[0].text}"`, { steps: [step], correlationId: newId() })])
    }
    if (intent.type === 'today') {
      const items = deriveToday(runtime.log.getEvents())
      const body = items.length ? `Today:\n${items.slice(0, 8).map((i) => '- ' + i.text).join('\n')}` : 'Nothing pressing today. Enjoy it.'
      // today's list can name bills and birthdays, so it is only ever read out as "the details are on screen"
      return setMessages((ms) => [...ms, say('assistant', body, { private: items.some((i) => privateIds.has(String(i.route).replace('/', ''))) })])
    }
    // undo: the most recent thing I did that is still done
    for (let i = messages.length - 1; i >= 0; i--) {
      const step = messages[i].steps?.find((x) => x.status === 'done' && x.commandId)
      if (step) {
        const r = await runtime.registry.undo(step.commandId)
        if (r.status === 'done') patchStep(messages[i].id, step.id, { status: 'undone', result: r.summary, commandId: null })
        return setMessages((ms) => [...ms, say('assistant', r.status === 'done' ? r.summary : r.error)])
      }
    }
    return setMessages((ms) => [...ms, say('assistant', "There's nothing recent to undo.")])
  }

  // "What do you think?": the one place he gives an opinion, and an AI call you asked for. It sees
  // the same shared data as the chat plus the week's review with anything private left out, and it
  // stops early in the month if the budget is running low.
  async function askOpinion(topic) {
    setError('')
    setNeedsCode(false)
    setBusy(true)
    try {
      const payload = buildOpinionRequest({ topic, registry: runtime.registry, events, shareSensitive: settings.shareSensitive, persona })
      setSeen({
        context: payload.context,
        turns: 1,
        tools: 0,
        shared: settings.shareSensitive,
        sources: contextSources(runtime.registry, events, { shareSensitive: settings.shareSensitive }),
        memories: memoriesFor(events, [{ role: 'user', text: topic ?? '' }], settings.shareSensitive),
        sent: JSON.stringify(payload, null, 2),
      })
      const body = await askJarvis(payload)
      if (body.spend) setSpend(body.spend)
      const reply = body.content?.find((b) => b.type === 'text')?.text?.trim()
      const words = reply || "I don't have enough to give you a fair opinion yet."
      setMessages((ms) => [...ms, say('assistant', words, { private: settings.shareSensitive.length > 0, local: false })])
      sayAloud({ text: words, steps: [] })
    } catch (err) {
      if (err.status === 429) setMessages((ms) => [...ms, say('assistant', err.message)])
      else {
        setError(err.message)
        setNeedsCode(err.status === 401)
      }
    } finally {
      setBusy(false)
    }
  }

  async function send(e) {
    e.preventDefault()
    const value = text.trim()
    if (!value || busy) return
    setText('')
    await sendText(value)
  }

  // The one path every message takes, whether typed, dictated once, or spoken in a live conversation.
  async function sendText(value) {
    if (!value || busy) return
    setError('')
    const intent = matchLocalIntent(value)
    if (intent) {
      await handleLocal(intent, value)
      return
    }
    setError('')
    setNeedsCode(false)
    setBusy(true)
    const history = [...messages, { id: newId(), role: 'user', text: value }]
    setMessages(history)
    try {
      const forModel = history.map((m) =>
        m.role === 'assistant' ? { role: 'assistant', text: m.memo || m.text || '(waiting for your approval)' } : m
      )
      const payload = buildRequest({ history: forModel, registry: runtime.registry, events, shareSensitive: settings.shareSensitive, persona })
      setSeen({
        context: payload.context,
        turns: payload.messages.length,
        tools: payload.tools.length,
        shared: settings.shareSensitive,
        sources: contextSources(runtime.registry, events, { shareSensitive: settings.shareSensitive }),
        memories: memoriesFor(events, forModel, settings.shareSensitive),
        sent: JSON.stringify({ messages: payload.messages, context: payload.context, persona: payload.persona, memory: payload.memory, today: payload.today, nowLocal: payload.nowLocal }, null, 2),
      })
      let reply = await askJarvis(payload)
      let escalated = false
      if (needsEscalation(reply, runtime.registry)) {
        // The small model's answer was unusable: ask a stronger one once. Any failure keeps the first answer.
        try {
          const second = await askJarvis({ ...payload, escalate: true })
          if (!needsEscalation(second, runtime.registry)) {
            reply = second
            escalated = true
          }
        } catch {
          /* keep the first answer */
        }
      }
      if (reply.spend) setSpend(reply.spend)
      const plan = planFromContent(reply.content, runtime.registry)
      const correlationId = newId()
      await runAutoSteps(plan.steps, runtime.registry, correlationId)
      const done = plan.steps.filter((s) => s.status === 'done').map((s) => s.result)
      // The assistant's own words when it has them; otherwise a routine line from the templates.
      const shown = replyFor({ text: plan.text, steps: plan.steps, seed: correlationId })
      setMessages((ms) => [
        ...ms,
        {
          id: newId(),
          role: 'assistant',
          text: shown,
          // history for the next turn includes what actually ran, so follow-ups make sense
          memo: [plan.text, done.length ? `(Done: ${done.join(' ')})` : ''].filter(Boolean).join(' ') || shown,
          correlationId,
          escalated,
          steps: plan.steps,
        },
      ])
      sayAloud({ text: plan.text || shown, steps: plan.steps })
    } catch (err) {
      if (err.status === 429) {
        // The month's allowance is used up. Said in his own words, in the chat, and what still works is named.
        setMessages([...history, say('assistant', err.message)])
        if (err.stopped) setSpend((s) => ({ ...(s ?? {}), stopped: true, rationed: true }))
      } else {
        setError(err.message)
        setNeedsCode(err.status === 401)
        setText(value)
        setMessages(messages)
      }
    } finally {
      setBusy(false)
    }
  }

  function toggleVoice() {
    if (listening) {
      stopVoice.current?.()
      return
    }
    setVoiceError('')
    const base = text.trim()
    setListening(true)
    try {
      stopVoice.current = startListening({
        onText: (heard) => setText(base ? `${base} ${heard}` : heard),
        onEnd: () => setListening(false),
        onError: (message) => {
          setVoiceError(message)
          setListening(false)
        },
      })
    } catch {
      setVoiceError('Voice input could not start in this browser.')
      setListening(false)
    }
  }

  // Tomorrow's briefing, built here from your own data. No AI call, so it is
  // free, instant and works offline.
  async function postBriefing() {
    const prefs = await runtime.store.getMeta('briefingPrefs')
    const b = composeBriefing(runtime.log.getEvents(), new Date(), prefs)
    setMessages((ms) => [
      ...ms,
      { id: newId(), role: 'assistant', text: `${b.title}\n${b.lines.join('\n')}`, memo: `Showed the briefing for ${b.tomorrow}.`, steps: [], private: true },
    ])
  }

  // Tapping the evening notification lands here.
  useEffect(() => {
    if (route?.sub === 'brief' && runtime && !briefed.current) {
      briefed.current = true
      if (Date.now() - lastLandingAt > 3000) {
        lastLandingAt = Date.now()
        postBriefing()
      }
      go('/jarvis', { replace: true })
    }
    // postBriefing only reads from runtime; it is safe to run once per landing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.sub, runtime])

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
        icon="bot"
        title="Jarvis"

        subtitle="Say what you did or what you need. I'll use the right apps and ask before anything that matters."
        right={
          <div className="text-right text-xs text-white/55 shrink-0">
            {spend && (
              <>
                AI this month
                <div className="text-white/60">${spend.spentUsd.toFixed(3)} of ${spend.capUsd.toFixed(2)}</div>
              </>
            )}
            {speaking && (
              <button onClick={() => { stopSpeaking(); setSpeaking(false) }} className="mt-1 underline hover:text-white/70 block ml-auto">Stop speaking</button>
            )}
            {messages.length > 0 && (
              <button onClick={() => setMessages([])} className="mt-1 underline hover:text-white/70">Clear chat</button>
            )}
          </div>
        }
      />

      <section aria-label="Home" className="mb-4">
        <p className="font-display text-xl text-white/90">{greeting(new Date(), myName)}</p>
        {!myName && !settings.nameAsked && (
          <form
            className="mt-2 flex flex-wrap items-center gap-2 text-sm"
            onSubmit={async (e) => {
              e.preventDefault()
              const name = nameDraft.trim().slice(0, 40)
              if (!name) return
              const r = await runtime.registry.invoke('memory__remember', { text: nameNote(name), role: 'name', category: 'fact', private: false, via: 'command' }, { approved: true, actor: 'user' })
              if (r.status === 'done') updateSettings({ nameAsked: true })
            }}
          >
            <label htmlFor="jarvis-name" className="text-white/70">What should I call you?</label>
            <input id="jarvis-name" value={nameDraft} maxLength={40} onChange={(e) => setNameDraft(e.target.value)} className="px-3 py-1 rounded-lg bg-white/5 border border-white/10" />
            <Button type="submit" disabled={!nameDraft.trim()}>Save</Button>
            <button type="button" className="text-xs underline text-white/50 hover:text-white/70" onClick={() => updateSettings({ nameAsked: true })}>Not now</button>
          </form>
        )}
        <JarvisNotes />
        <div className="-mt-2"><TodayCard /></div>
      </section>

      <div className="flex-1 space-y-3 pb-4" role="log" aria-live="polite" aria-relevant="additions" aria-label="Conversation">
        {messages.length === 0 && (
          <Empty>
            Try: "ran 30 minutes and read 20 pages", "add dentist Friday 3pm", "I spent $12 on lunch", or "make me a tracker for houseplants".
          </Empty>
        )}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-emerald-500/20 border border-emerald-400/20 px-4 py-2 text-sm">{m.text}</div>
            </div>
          ) : (
            <div key={m.id} className="flex gap-2">
              <span className="mt-1 grid place-items-center w-7 h-7 rounded-full bg-white/10 shrink-0"><Bot size={14} /></span>
              <div className="max-w-[90%] space-y-2">
                {m.text && <div className="rounded-2xl rounded-bl-md bg-white/[0.06] border border-white/10 px-4 py-2 text-sm whitespace-pre-line">{m.text}</div>}
                {m.link && (
                  <div className="text-xs">
                    <Link to={m.link.path} className="underline text-sky-200 hover:text-sky-100">Open {m.link.label}</Link>
                  </div>
                )}
                {m.escalated && <div className="text-[11px] text-white/45">Double-checked with a stronger model.</div>}
                {(m.text || m.steps?.length > 0) && (
                  <ReplyFeedback message={m} said={messages.slice(0, i).reverse().find((x) => x.role === 'user')?.text} privateIds={privateIds} rated={repliesRated.get(m.id)} runtime={runtime} />
                )}
                {m.steps?.map((s) => (
                  <div key={s.id} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs text-white/55">{s.moduleName} · {s.name.split('__')[1].replaceAll('_', ' ')}</div>
                        <div className="text-white/70 text-xs break-words">{prettyArgs(s.args)}</div>
                      </div>
                      <span className={`text-xs shrink-0 ${s.status === 'done' ? 'text-emerald-300' : s.status === 'error' ? 'text-rose-300' : 'text-amber-200'}`}>
                        {STATUS_LABEL[s.status] ?? s.status}
                      </span>
                    </div>
                    {s.result && <div className="mt-1 text-white/80">{s.result}</div>}
                    {stepLink(s) && (
                      <div className="mt-1 text-xs">
                        <Link to={stepLink(s).path} className="underline text-sky-200 hover:text-sky-100">Open {stepLink(s).label}</Link>
                      </div>
                    )}
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
        {busy && <div role="status" className="text-sm text-white/55 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Thinking...</div>}
        {error && <div role="alert" className="text-sm text-rose-300">{error}</div>}
        {needsCode && (
          <AccessCodePrompt
            onSaved={() => {
              setNeedsCode(false)
              setError('Saved. Press send again.')
            }}
          />
        )}
        <div ref={bottom} />
      </div>

      <div className="pb-2">
        <button onClick={postBriefing} className="text-xs px-3 py-1 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-white/70">
          Brief me on tomorrow
        </button>
      </div>

      {seen && (
        <details className="text-xs text-white/55 pb-2">
          <summary className="cursor-pointer hover:text-white/60">What the AI saw for your last message</summary>
          <div className="mt-2 space-y-2 rounded-lg bg-white/[0.03] border border-white/10 p-3">
            <p>Your message plus {Math.max(0, seen.turns - 1)} earlier chat turn{seen.turns === 2 ? '' : 's'}, the list of {seen.tools} actions it can use, and today's date.</p>
            <p>Private areas shared: {seen.shared.length ? seen.shared.join(', ') : 'none'}. The vault is never shared.</p>
            <div>
              <p className="text-white/50">What I remembered about you that was included:</p>
              {seen.memories.length === 0 ? (
                <p className="mt-1 text-white/60">(no notes)</p>
              ) : (
                <ul className="mt-1 list-disc pl-5 text-white/60">{seen.memories.map((n) => <li key={n.id}>{n.text}{n.private ? ' (private, shared by you)' : ''}</li>)}</ul>
              )}
              <button type="button" className="mt-1 underline hover:text-white/80" onClick={() => go('/jarvis/memory')}>Correct it</button>
            </div>
            <div>
              <p className="text-white/50">Summary of your apps that was included:</p>
              {seen.sources.used.length === 0 && <p className="mt-1 text-white/60">(nothing)</p>}
              <ul className="mt-1 space-y-2">
                {seen.sources.used.map((u) => (
                  <li key={u.id} className="rounded-md bg-white/[0.03] border border-white/10 p-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-white/70">{u.name}{u.sensitive ? ' (private, shared by you)' : ''}</span>
                      <span className="flex gap-2">
                        <button type="button" className="underline hover:text-white/80" onClick={() => go(u.id === 'evergrove' ? '/' : appPath(u.id))}>Correct it</button>
                        {u.sensitive && (
                          <button
                            type="button"
                            className="underline text-rose-300 hover:text-rose-200"
                            onClick={() => {
                              updateSettings({ shareSensitive: settings.shareSensitive.filter((id) => id !== u.id) })
                              setSeen({ ...seen, shared: seen.shared.filter((id) => id !== u.id), sources: { used: seen.sources.used.filter((x) => x.id !== u.id), withheld: [...seen.sources.withheld, { id: u.id, name: u.name }] } })
                            }}
                          >
                            Stop sharing
                          </button>
                        )}
                      </span>
                    </div>
                    <pre className="mt-1 whitespace-pre-wrap font-sans text-white/60">{u.text}</pre>
                  </li>
                ))}
              </ul>
              {seen.sources.withheld.length > 0 && <p className="mt-2 text-white/50">Kept private and not sent: {seen.sources.withheld.map((w) => w.name).join(', ')}.</p>}
            </div>
            <div className="flex gap-2 items-center">
              <button
                type="button"
                className="px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 border border-white/10"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(seen.sent)
                    setCopiedSent(true)
                    setTimeout(() => setCopiedSent(false), 2000)
                  } catch {
                    setError('Copying was blocked by the browser.')
                  }
                }}
              >
                {copiedSent ? 'Copied' : 'Copy exactly what was sent'}
              </button>
              <span className="text-white/45">The action list and a few fixed instructions are not included in the copy.</span>
            </div>
          </div>
        </details>
      )}

      {voiceError && <p className="text-xs text-rose-300 pb-1">{voiceError}</p>}
      {conversing ? (
        <p className="text-xs text-sky-200 pb-1" role="status">
          {speaking ? "Jarvis is talking..." : listening ? 'Listening — just say the next thing.' : 'Thinking...'}
        </p>
      ) : (
        speechSupported() && listening && <p className="text-xs text-white/55 pb-1">Listening... your browser's speech service turns your voice into text.</p>
      )}

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
        {speechSupported() && speechOutSupported() && (
          <Button
            variant={conversing ? 'primary' : 'ghost'}
            onClick={conversing ? endConversation : startConversation}
            className="h-11 w-11 grid place-items-center !p-0 rounded-full"
            aria-label={conversing ? 'End conversation' : 'Start a spoken conversation'}
            aria-pressed={conversing}
            title={conversing ? 'End conversation' : 'Have a real back-and-forth: he listens, answers, and listens again'}
          >
            <Headphones size={16} />
          </Button>
        )}
        {speechSupported() && !conversing && (
          <Button
            variant={listening ? 'primary' : 'ghost'}
            onClick={toggleVoice}
            className="h-11 w-11 grid place-items-center !p-0 rounded-full"
            aria-label={listening ? 'Stop listening' : 'Speak to Jarvis'}
            aria-pressed={listening}
          >
            {listening ? <Square size={14} /> : <Mic size={16} />}
          </Button>
        )}
        <Button type="submit" disabled={busy || !text.trim()} className="h-11 w-11 grid place-items-center !p-0 rounded-full" aria-label="Send">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </Button>
      </form>
    </div>
  )
}
