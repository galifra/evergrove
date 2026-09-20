import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@evergrove/kit/AppContext.jsx'
import { useAction } from '@evergrove/kit/components/useAction.js'
import { Button, Card, ErrorNote, Field, PageHeader, Select, TextInput } from '@evergrove/ui/components/ui.jsx'
import { deriveMemory, nameNote } from '@evergrove/modules/memory.js'
import { listVoices, speak, speechOutSupported, stopSpeaking } from '../lib/speak'

// How Jarvis speaks to you. Everything here is stored on this device.
export default function JarvisSettings() {
  const { settings, updateSettings, events } = useApp()
  const { act, error: nameError, busy } = useAction()
  const memory = useMemo(() => deriveMemory(events), [events])
  const [nameDraft, setNameDraft] = useState(null)
  const nameValue = nameDraft ?? memory.name

  async function saveName() {
    const name = nameValue.trim().slice(0, 40)
    if (!name || name === memory.name) return setNameDraft(null)
    const existing = memory.notes.filter((n) => n.role === 'name').pop()
    const ok = existing
      ? await act('memory__revise', { note: existing.text, text: nameNote(name) })
      : await act('memory__remember', { text: nameNote(name), role: 'name', category: 'fact', private: false, via: 'command' })
    if (ok) {
      updateSettings({ nameAsked: true })
      setNameDraft(null)
    }
  }
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
          <div className="sm:col-span-2 flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[10rem]"><Field label="Your name"><TextInput value={nameValue} maxLength={40} placeholder="What should he call you?" onChange={(e) => setNameDraft(e.target.value)} /></Field></div>
            <Button onClick={saveName} disabled={busy || !nameValue.trim() || nameValue.trim() === memory.name}>Save name</Button>
          </div>
          <div className="sm:col-span-2"><ErrorNote>{nameError}</ErrorNote></div>
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
        <p className="mt-2 text-xs text-white/55">Only your name, the style and this word are sent to the assistant. He is always honest and short either way.</p>
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
