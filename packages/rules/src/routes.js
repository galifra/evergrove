import { DOMAIN_MAP } from '@evergrove/core/lib/domains.js'
import { BUILTIN_TRACKERS } from './trackers.js'

// The route table (docs/v2/ARCHITECTURE.md). One row per app. The entry
// generator, the shell's app switcher, the router and the manifests all read
// this, so a page can never exist without a route or a route without a page.

export const HUB = [
  { id: 'evergrove', path: '/', name: 'Evergrove', short: 'Evergrove', kind: 'hub', color: '#34d399', icon: 'trees', description: 'Your tree and everything that grows it.' },
  { id: 'apps', path: '/apps', name: 'Apps', short: 'Apps', kind: 'hub', color: '#34d399', icon: 'layout-grid', description: 'Every app, and ideas ready to build.' },
  { id: 'log', path: '/log', name: 'Log', short: 'Log', kind: 'hub', color: '#94a3b8', icon: 'scroll-text', description: 'The shared log everything writes to.' },
]

export const MODULES = [
  { id: 'tasks', path: '/tasks', name: 'Tasks & habits', short: 'Tasks', kind: 'module', color: '#f59e0b', icon: 'check-square', description: 'One-off and repeating tasks, and habits.' },
  { id: 'calendar', path: '/calendar', name: 'Calendar', short: 'Calendar', kind: 'module', color: '#60a5fa', icon: 'calendar', description: 'Events, repeats and clashes.' },
  { id: 'money', path: '/money', name: 'Money', short: 'Money', kind: 'module', color: '#22c55e', icon: 'wallet', private: true, description: 'Purchases, bills, budgets, debts. Tracking only.' },
  { id: 'goals', path: '/goals', name: 'Goals', short: 'Goals', kind: 'module', color: '#a78bfa', icon: 'target', description: 'Goals, milestones and linked tasks.' },
  { id: 'people', path: '/people', name: 'People', short: 'People', kind: 'module', color: '#f472b6', icon: 'users', private: true, description: 'Birthdays, likes, gift ideas, last contact.' },
  { id: 'vault', path: '/vault', name: 'Vault', short: 'Vault', kind: 'module', color: '#94a3b8', icon: 'lock', private: true, description: 'Encrypted documents and the security checklist.' },
]

export const TRACKERS = BUILTIN_TRACKERS.map((t) => ({
  id: t.id,
  path: `/${t.id}`,
  name: t.name,
  short: t.name.split(' ')[0],
  kind: 'tracker',
  color: DOMAIN_MAP[t.area].color,
  icon: t.icon,
  private: !!t.sensitive,
  description: t.description,
  trackerId: t.id,
}))

// `id` stays 'jarvis' (an internal key: the folder it loads from, the events it writes) even
// though the product is now called MOXIE — renaming it would mean rewriting every historical
// event already in a live log. Only what a person actually sees (the path, the name) changes.
export const MOXIE = { id: 'jarvis', path: '/moxie', name: 'MOXIE', short: 'MOXIE', kind: 'assistant', color: '#38bdf8', icon: 'bot', description: 'Your own executive intelligence and counsel: chat, memory, briefings and honest feedback.' }

// Trackers made by talking have no page at build time; one entry serves them all.
export const CUSTOM_TRACKER = { id: 'custom-tracker', path: '/t', name: 'Tracker', short: 'Tracker', kind: 'tracker', color: '#34d399', icon: 'sparkles', description: 'A tracker you made by talking to MOXIE.', custom: true }

export const ROUTES = [...HUB, ...MODULES, ...TRACKERS, MOXIE]

// Every page that has its own generated entry.
export const ENTRIES = [...ROUTES, CUSTOM_TRACKER]

// Which JavaScript app serves a route: the mother app, or MOXIE.
export const appOf = (route) => (route.id === 'jarvis' ? 'jarvis' : 'evergrove')

export const routeById = (id) => ROUTES.find((r) => r.id === id) ?? null

const trim = (p) => (p.length > 1 ? p.replace(/\/+$/, '') : p) || '/'

// Finds the route for a URL path. `/money/` and `/money` are the same;
// `/moxie/memory` is the MOXIE route with a screen; `/t/<id>` is a custom tracker.
export function routeForPath(pathname) {
  const p = trim(String(pathname || '/').split('?')[0].split('#')[0])
  const parts = p.split('/').filter(Boolean)
  if (!parts.length) return { ...HUB[0], sub: null }
  const first = parts[0]
  if (first === 't') return { ...CUSTOM_TRACKER, trackerId: parts[1] ? decodeURIComponent(parts[1]) : null, sub: null }
  const route = ROUTES.find((r) => r.path === `/${first}`)
  if (!route) return null
  return { ...route, sub: parts.slice(1).join('/') || null }
}

// The address that serves a route's page (a route's own folder, or /t/ for custom trackers).
export const entryPath = (route) => (route.custom ? '/t/' : route.path === '/' ? '/' : `${route.path}/`)

// Two paths are the same page-load when one entry serves both, so moving between
// them can happen inside the open page. Anything else is a real navigation.
export function sameEntry(a, b) {
  const ra = routeForPath(a)
  const rb = routeForPath(b)
  return !!ra && !!rb && entryPath(ra) === entryPath(rb)
}

export const trackerPath = (id) => (TRACKERS.some((t) => t.id === id) ? `/${id}` : `/t/${encodeURIComponent(id)}`)

// Old links, forever: `#/app/<id>`, `#/timeline`, `#/apps`, `#/jarvis`, `#/jarvis/brief`.
// Returns the new path, or null if the hash is not an old link.
export function legacyRedirect(hash) {
  const h = String(hash || '').replace(/^#/, '')
  if (!h.startsWith('/')) return null
  const [, first, second, ...rest] = h.split('/')
  if (!first) return null
  if (first === 'app') return second ? trackerOrModulePath(decodeURIComponent(second)) : '/apps'
  if (first === 'timeline') return '/log'
  if (first === 'apps') return '/apps'
  if (first === 'jarvis') return `/moxie${second ? `/${[second, ...rest].join('/')}` : ''}`
  return null
}

export const appPath = (id) => trackerOrModulePath(id)

function trackerOrModulePath(id) {
  const known = [...MODULES, ...TRACKERS].find((r) => r.id === id)
  return known ? known.path : `/t/${encodeURIComponent(id)}`
}

// The address to actually navigate to: an app's own page ends in a slash (`/money/`),
// which is what its manifest scope expects; screens inside MOXIE and custom trackers keep their tail.
export function canonicalPath(link) {
  const target = normalizeLink(link)
  const [pathPart, ...tail] = target.split(/(?=[?#])/)
  const route = routeForPath(pathPart)
  if (!route) return target
  const rest = tail.join('')
  if (route.custom) return route.trackerId ? `/t/${encodeURIComponent(route.trackerId)}${rest}` : `/t/${rest}`
  if (route.sub) return `${route.path}/${route.sub}${rest}`
  return `${entryPath(route)}${rest}`
}

// Internal links written before version 2 (`/app/money`) still work.
export function normalizeLink(link) {
  // Only a path on this same address is ever a link target: never a script address, another site, or `//host`.
  const inward = typeof link === 'string' && link.startsWith('/') && !link.startsWith('//') && ![...link].some((c) => c === '\\' || c.charCodeAt(0) < 32)
  if (!inward) return '/'
  const m = link.match(/^\/app\/([^/?#]+)/)
  return m ? trackerOrModulePath(decodeURIComponent(m[1])) : link === '/timeline' ? '/log' : link
}
