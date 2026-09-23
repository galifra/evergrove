import { appPath, TRACKERS } from '@evergrove/rules/routes.js'

// Small pure helpers for Jarvis's home screen and answers.

// A greeting by local time of day. With a name it becomes "Good morning, Sam."
export function greeting(now = new Date(), name = '') {
  const h = now.getHours()
  const part = h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
  const who = String(name ?? '').trim()
  return who ? `${part}, ${who}.` : `${part}.`
}

const norm = (s) => String(s ?? '').trim().toLowerCase()

// Where to send you after MOXIE did something: the app it touched. Returns
// { label, path } or null when there is nowhere better than staying here.
export function stepLink(step) {
  if (!step || step.status !== 'done') return null
  const [moduleId, action] = String(step.name).split('__')
  if (moduleId === 'evergrove') {
    if (action === 'log_tracker_entry') {
      const wanted = norm(step.args?.tracker)
      const t = TRACKERS.find((x) => x.id === wanted || norm(x.name) === wanted || norm(x.name).startsWith(wanted))
      return t ? { label: t.name, path: t.path } : { label: 'the tracker', path: '/apps' }
    }
    if (action === 'create_tracker') return { label: 'Apps', path: '/apps' }
    if (action === 'request_app') return { label: 'app ideas', path: '/apps' }
    return { label: 'your tree', path: '/' }
  }
  if (moduleId === 'memory') return { label: 'what I remember', path: '/moxie/memory' }
  const path = appPath(moduleId)
  const names = { tasks: 'Tasks', calendar: 'Calendar', money: 'Money', goals: 'Goals', people: 'People', vault: 'Vault' }
  return names[moduleId] ? { label: names[moduleId], path } : null
}
