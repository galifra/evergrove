// Voice input using the browser's built-in speech recognition. No library, no
// server of ours. Note the browser may send the audio to its own speech
// service (Chrome does), which the UI says out loud.

export function speechSupported() {
  return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition)
}

const MESSAGES = {
  'not-allowed': 'Microphone permission was blocked. Allow it for this site in your browser settings.',
  'service-not-allowed': 'Microphone permission was blocked. Allow it for this site in your browser settings.',
  'no-speech': "I didn't hear anything. Try again a little closer to the mic.",
  'audio-capture': 'No microphone was found.',
  network: 'Speech recognition needs an internet connection.',
}

// Starts listening; calls onText(fullTranscriptSoFar, isFinal) as words arrive.
// Returns a function that stops listening.
export function startListening({ onText, onEnd, onError, lang = navigator.language || 'en-US' }) {
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition
  const rec = new Rec()
  rec.lang = lang
  rec.interimResults = true
  rec.continuous = false
  rec.maxAlternatives = 1

  rec.onresult = (event) => {
    let text = ''
    let final = true
    for (let i = 0; i < event.results.length; i++) {
      text += event.results[i][0].transcript
      if (!event.results[i].isFinal) final = false
    }
    onText(text.trim(), final)
  }
  rec.onerror = (event) => onError?.(MESSAGES[event.error] ?? `Voice input stopped (${event.error}).`)
  rec.onend = () => onEnd?.()

  rec.start()
  return () => {
    try {
      rec.stop()
    } catch {
      // already stopped
    }
  }
}
