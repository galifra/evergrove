import { useEffect, useState } from 'react'
import { useApp } from '@evergrove/kit/AppContext.jsx'
import { Card, Field, PageHeader, Select, TextInput } from '@evergrove/ui/components/ui.jsx'
import { listVoices, speak, speechOutSupported, stopSpeaking } from '../lib/speak'

// How Jarvis speaks to you. Everything here is stored on this device.
export default function JarvisSettings() {
  const { settings, updateSettings } = useApp()
  const [voices, setVoices] = useState(listVoices)
  const canSpeak = speechOutSupported()

  // Browsers load their voice list a moment after the page opens.
  useEffect(() => {
    if (!canSpeak) return undefined
    const refresh = () => setVoices(listVoices())
    window.speechSynthesis.addEventListener?.('voiceschanged', refresh)
    refresh()
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', refresh)
  }, [canSpeak])

  return (
    <div className="grid gap-4">
      <PageHeader icon="bot" title="Jarvis settings" subtitle="How he talks to you, and how often he speaks up." />

      <Card title="Manner">
        <div className="grid gap-3 sm:grid-cols-2 max-w-xl">
          <Field label="Style">
            <Select
              value={settings.jarvisStyle}
              onChange={(e) => updateSettings({ jarvisStyle: e.target.value })}
              options={[{ value: 'plain', label: 'Plain: friendly and direct' }, { value: 'butler', label: 'Butler: a little formal' }]}
            />
          </Field>
          {settings.jarvisStyle === 'butler' && (
            <Field label="What he calls you (optional)">
              <TextInput value={settings.jarvisTitle} maxLength={20} placeholder="sir, ma'am, boss..." onChange={(e) => updateSettings({ jarvisTitle: e.target.value })} />
            </Field>
          )}
        </div>
        <p className="mt-2 text-xs text-white/55">Only the style and this word are sent to the assistant. He is always honest and short either way.</p>
      </Card>

      <Card title="Speaking aloud">
        {!canSpeak ? (
          <p className="text-sm text-white/60">This browser can't speak replies aloud.</p>
        ) : (
          <div className="grid gap-3 max-w-xl">
            <label className="flex items-center gap-3 text-sm cursor-pointer">
              <input type="checkbox" className="w-4 h-4 accent-sky-400" checked={settings.speakReplies} onChange={(e) => { updateSettings({ speakReplies: e.target.checked }); if (!e.target.checked) stopSpeaking() }} />
              Read his replies aloud
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Voice">
                <Select
                  value={settings.voiceURI}
                  onChange={(e) => updateSettings({ voiceURI: e.target.value })}
                  options={[{ value: '', label: 'Browser default' }, ...voices.map((v) => ({ value: v.voiceURI, label: `${v.name} (${v.lang})` }))]}
                />
              </Field>
              <Field label={`Speed: ${Number(settings.speechRate).toFixed(1)}x`}>
                <input type="range" min="0.6" max="1.6" step="0.1" value={settings.speechRate} onChange={(e) => updateSettings({ speechRate: Number(e.target.value) })} className="w-full accent-sky-400" aria-label="Speech speed" />
              </Field>
            </div>
            <div>
              <button
                type="button"
                className="text-sm underline text-sky-200 hover:text-sky-100"
                onClick={() => speak('Good evening. Your day looks quiet.', { voiceURI: settings.voiceURI, rate: settings.speechRate })}
              >
                Hear a sample
              </button>
            </div>
            <p className="text-xs text-white/55">Uses your browser's own voice, on this device. Details from private apps are never read aloud unless you shared that app.</p>
          </div>
        )}
      </Card>
    </div>
  )
}
