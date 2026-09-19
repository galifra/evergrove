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
}
