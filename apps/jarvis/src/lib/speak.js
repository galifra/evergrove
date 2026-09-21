import { TRACKERS } from '@evergrove/rules/routes.js'

// Spoken replies (P5.5) with the browser's built-in voice: free, on the device,
// nothing sent to us. What is spoken is chosen here so that private details are
// never read aloud unless the user shared that app with the assistant.

export const speechOutSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'

export const listVoices = () => (speechOutSupported() ? window.speechSynthesis.getVoices() : [])

// Plain words for a voice: no markdown, links, bullets or emoji, and a sane length.
export function speakableText(text, max = 400) {
  return String(text ?? '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_`#>]+/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

const norm = (s) => String(s ?? '').trim().toLowerCase()

// Did this step touch a private app? `privateIds` are the ids of private modules
// and trackers; `shared` are the ones the user chose to share.
export function stepIsPrivate(step, privateIds, shared = []) {
  const [moduleId, action] = String(step?.name ?? '').split('__')
  const touched = [moduleId]
  if (action === 'log_tracker_entry') {
    const wanted = norm(step.args?.tracker)
    const t = TRACKERS.find((x) => x.id === wanted || norm(x.name) === wanted)
    touched.push(t ? t.id : wanted)
  }
  return touched.some((id) => privateIds.has(id) && !shared.includes(id))
}

// What to say out loud for a reply. If any action touched a private app that has
// not been shared, the reply is not read: only that something was done, and where.
export function speakableReply({ text, steps = [], private: builtFromPrivate = false }, { privateIds = new Set(), shared = [] } = {}) {
  // A reply worked out on the device from private data (today's list, a briefing) is never read out either.
  if (builtFromPrivate) return 'The details are on screen.'
  const touchedPrivate = steps.filter((s) => s.status !== 'error' && stepIsPrivate(s, privateIds, shared))
  if (touchedPrivate.length) return `Done. The details are in ${touchedPrivate[0].moduleName ?? 'the app'}.`
  return speakableText(text)
}

let speaking = null

export function speak(text, { voiceURI = '', rate = 1, onEnd } = {}) {
  if (!speechOutSupported() || !text) return false
  stopSpeaking()
  const u = new SpeechSynthesisUtterance(text)
  u.rate = Math.min(2, Math.max(0.5, Number(rate) || 1))
  const voice = voiceURI ? listVoices().find((v) => v.voiceURI === voiceURI) : null
  if (voice) u.voice = voice
  u.onend = u.onerror = () => {
    if (speaking === u) speaking = null
    onEnd?.()
  }
  speaking = u
  window.speechSynthesis.speak(u)
  return true
}

export function stopSpeaking() {
  if (!speechOutSupported()) return
  speaking = null
  window.speechSynthesis.cancel()
}

export const isSpeaking = () => speaking !== null
