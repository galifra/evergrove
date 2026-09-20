import { useEffect, useState } from 'react'
import { canonicalPath, legacyRedirect, routeForPath, sameEntry } from '@evergrove/rules/routes.js'

// Path-based routing (docs/v2/ARCHITECTURE.md). Each app is its own page, so
// moving between apps is a real navigation; moving between screens of one app
// (Jarvis, memory, weekly) happens inside the open page with the history API.

const NAV_EVENT = 'evergrove:navigate'

export function currentPath() {
  return window.location.pathname
}

// Old links (`/#/app/money`) go to their new path. Runs once, before anything renders.
// Returns true when it redirected, so the caller can stop.
export function redirectLegacyHash() {
  const target = legacyRedirect(window.location.hash)
  if (!target) return false
  window.location.replace(target)
  return true
}

export function usePath() {
  const [path, setPath] = useState(currentPath)
  useEffect(() => {
    const onChange = () => setPath(currentPath())
    window.addEventListener('popstate', onChange)
    window.addEventListener(NAV_EVENT, onChange)
    return () => {
      window.removeEventListener('popstate', onChange)
      window.removeEventListener(NAV_EVENT, onChange)
    }
  }, [])
  return path
}

// The route (and Jarvis screen or custom tracker id) for the current page.
export function useRoute() {
  return routeForPath(usePath())
}

export function go(link, { replace = false } = {}) {
  const target = canonicalPath(link)
  if (sameEntry(currentPath(), target)) {
    window.history[replace ? 'replaceState' : 'pushState']({}, '', target)
    window.dispatchEvent(new Event(NAV_EVENT))
    return
  }
  if (replace) window.location.replace(target)
  else window.location.assign(target)
}
