const ACCESS_CODE_KEY = 'evergrove_access_code'

export function getAccessCode() {
  try {
    return localStorage.getItem(ACCESS_CODE_KEY) || ''
  } catch {
    return ''
  }
}

export function setAccessCode(code) {
  localStorage.setItem(ACCESS_CODE_KEY, code)
  // lets sync retry the moment a code is entered, wherever it was entered
  window.dispatchEvent(new Event('evergrove-code-changed'))
}
