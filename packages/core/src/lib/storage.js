const ACCESS_CODE_KEY = 'evergrove_access_code'
const DEVICE_KEY = 'evergrove_device_id'

export function getAccessCode() {
  try {
    return localStorage.getItem(ACCESS_CODE_KEY) || ''
  } catch {
    return ''
  }
}

// A short random id for this browser, made once and kept. It only labels which device wrote an event.
export function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (!id) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('')
      localStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch {
    return null
  }
}

export function setAccessCode(code) {
  localStorage.setItem(ACCESS_CODE_KEY, code)
  // lets sync retry the moment a code is entered, wherever it was entered
  window.dispatchEvent(new Event('evergrove-code-changed'))
}
