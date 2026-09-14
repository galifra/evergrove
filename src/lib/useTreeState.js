import { useCallback, useEffect, useState } from 'react'
import { defaultState, loadState, saveState, getAccessCode } from './storage'
import { levelFromXp, skillTotalXp, slugify } from './treeEngine'
import { DOMAIN_MAP } from './domains'

export function useTreeState() {
  const [state, setState] = useState(loadState)
  const [pending, setPending] = useState(false)
  const [lastResult, setLastResult] = useState(null) // { summary, levelUps: [], error }

  useEffect(() => {
    saveState(state)
  }, [state])

  const updateSettings = useCallback((patch) => {
    setState((s) => ({ ...s, settings: { ...s.settings, ...patch } }))
  }, [])

  const renameTree = useCallback((name) => {
    setState((s) => ({ ...s, treeName: name }))
  }, [])

  const resetAll = useCallback(() => {
    setState(defaultState())
  }, [])

  const importState = useCallback((incoming) => {
    setState({ ...defaultState(), ...incoming })
  }, [])

  const addEntry = useCallback(
    async (text) => {
      const trimmed = text.trim()
      if (!trimmed) return

      setPending(true)
      setLastResult(null)

      // build a compact snapshot of existing skills so the AI can reuse ids
      // instead of inventing near-duplicates ("running" vs "run") each time.
      const existingSkills = {}
      for (const [domainId, skills] of Object.entries(state.skills)) {
        existingSkills[domainId] = Object.values(skills).map((s) => ({ id: s.id, name: s.name }))
      }

      try {
        const res = await fetch('/api/parse-entry', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-app-code': getAccessCode(),
          },
          body: JSON.stringify({ text: trimmed, existingSkills }),
        })

        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || `Request failed (${res.status})`)
        }

        const data = await res.json()
        const updates = Array.isArray(data.updates) ? data.updates : []

        const levelUps = []

        setState((s) => {
          const draft = {
            ...s,
            skills: Object.fromEntries(Object.entries(s.skills).map(([k, v]) => [k, { ...v }])),
          }

          for (const u of updates) {
            const domain = DOMAIN_MAP[u.domain]
            if (!domain) continue // defensive: ignore anything outside the known domain set
            const xpGain = Math.max(1, Math.min(40, Math.round(Number(u.xpGain) || 0)))
            if (!xpGain) continue

            const skillId = slugify(u.skillId || u.skillName || 'skill')
            const domainSkills = draft.skills[domain.id] ? { ...draft.skills[domain.id] } : {}
            const existing = domainSkills[skillId]
            const before = existing ? levelFromXp(skillTotalXp(existing)).level : 0

            const nextSkill = existing
              ? { ...existing, xp: existing.xp + xpGain, updatedAt: new Date().toISOString() }
              : {
                  id: skillId,
                  name: (u.skillName || skillId).slice(0, 60),
                  xp: xpGain,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                }

            const after = levelFromXp(skillTotalXp(nextSkill)).level
            if (after > before) {
              levelUps.push({ domain, skillName: nextSkill.name, level: after })
            }

            domainSkills[skillId] = nextSkill
            draft.skills[domain.id] = domainSkills
          }

          draft.entries = [
            {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              text: trimmed,
              createdAt: new Date().toISOString(),
              updates,
              summary: data.summary || '',
            },
            ...s.entries,
          ].slice(0, 500)

          return draft
        })

        setLastResult({ summary: data.summary, updates, levelUps, clarify: updates.length === 0 })
        return { summary: data.summary, updates, levelUps }
      } catch (err) {
        setLastResult({ error: err.message || 'Something went wrong logging that.' })
        return { error: err.message }
      } finally {
        setPending(false)
      }
    },
    [state]
  )

  return { state, setState, pending, lastResult, addEntry, updateSettings, renameTree, resetAll, importState }
}
