// A page that stays open across a deploy can ask for a file that no longer
// exists (its name changes with every build). When that happens, reload once to
// get the current version. The guard stops a broken deploy from reloading forever.
const KEY = 'evergrove_chunk_reload_at'

export function registerChunkRecovery(win = window) {
  win.addEventListener('vite:preloadError', (event) => {
    let last = 0
    try {
      last = Number(win.sessionStorage.getItem(KEY)) || 0
    } catch {
      // storage blocked: reload once anyway
    }
    if (Date.now() - last < 10_000) return
    try {
      win.sessionStorage.setItem(KEY, String(Date.now()))
    } catch {
      // ignore
    }
    event.preventDefault?.()
    win.location.reload()
  })
}
