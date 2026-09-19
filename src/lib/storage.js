const STORAGE_KEY = 'evergrove_state_v1'
const ACCESS_CODE_KEY = 'evergrove_access_code'

export function defaultState() {
  return {
    version: 1,
    treeName: 'My Grove',
    createdAt: new Date().toISOString(),
    skills: {}, // { [domainId]: { [skillId]: { id, name, xp, createdAt, updatedAt } } }
    entries: [], // { id, text, createdAt, updates: [{domain, skillId, skillName, xpGain, reason}], summary }
    settings: {
      reminderEnabled: false,
      reminderTime: '21:00',
      onboarded: false,
    },
  }
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultState()
    const parsed = JSON.parse(raw)
    // shallow-merge with defaults so new fields added later don't crash old saves
    const base = defaultState()
    return {
      ...base,
      ...parsed,
      settings: { ...base.settings, ...(parsed.settings || {}) },
      skills: parsed.skills || {},
      entries: parsed.entries || [],
    }
  } catch {
    return defaultState()
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch (err) {
    console.error('Failed to save Evergrove state', err)
  }
}

export function exportStateAsFile(state) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `evergrove-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export function getAccessCode() {
  return localStorage.getItem(ACCESS_CODE_KEY) || ''
}

export function setAccessCode(code) {
  localStorage.setItem(ACCESS_CODE_KEY, code)
}
