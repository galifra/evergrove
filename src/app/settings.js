const KEY = 'evergrove_settings_v2'
const LEGACY_KEY = 'evergrove_state_v1'

export function defaultSettings() {
  return {
    treeName: 'My Grove',
    reminderEnabled: false,
    reminderTime: '21:00',
    briefingDetail: 'full',
    showAmounts: false,
    onboarded: false,
    shareSensitive: [],
    syncPassphrase: '',
  }
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...defaultSettings(), ...JSON.parse(raw) }
    // First run of the new version: carry over what the old save knew.
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null')
    if (legacy) {
      return {
        ...defaultSettings(),
        treeName: legacy.treeName ?? 'My Grove',
        reminderEnabled: !!legacy.settings?.reminderEnabled,
        reminderTime: legacy.settings?.reminderTime ?? '21:00',
        onboarded: !!legacy.settings?.onboarded,
      }
    }
  } catch {
    // fall through to defaults
  }
  return defaultSettings()
}

export function saveSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch (err) {
    console.error('Could not save settings', err)
  }
}

export function loadLegacyTree() {
  try {
    return JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null')
  } catch {
    return null
  }
}
