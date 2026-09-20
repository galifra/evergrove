import { describe, it, expect } from 'vitest'
import { ENTRIES, ROUTES, appOf, canonicalPath, entryPath, legacyRedirect, normalizeLink, routeById, routeForPath, sameEntry, trackerPath } from './routes.js'
import { listApps } from './registry.js'
import { BUILTIN_TRACKERS } from './trackers.js'

describe('the route table', () => {
  it('has a unique id and a unique path for every route', () => {
    expect(new Set(ROUTES.map((r) => r.id)).size).toBe(ROUTES.length)
    expect(new Set(ENTRIES.map((r) => r.path)).size).toBe(ENTRIES.length)
  })

  it('covers every app in the registry: no app without a route (T-P2a)', () => {
    const ids = new Set(ROUTES.map((r) => r.id))
    for (const app of listApps([])) expect(ids.has(app.id), `${app.id} has no route`).toBe(true)
  })

  it('has a route for every built-in tracker, coloured by its area', () => {
    for (const t of BUILTIN_TRACKERS) {
      const r = routeById(t.id)
      expect(r, t.id).toBeTruthy()
      expect(r.path).toBe(`/${t.id}`)
      expect(r.color).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('every route has what a manifest needs: a name, a colour and an icon', () => {
    for (const r of ENTRIES) {
      expect(r.name.length).toBeGreaterThan(0)
      expect(r.color).toMatch(/^#[0-9a-f]{6}$/i)
      expect(r.icon.length).toBeGreaterThan(0)
      expect(r.path.startsWith('/')).toBe(true)
    }
  })

  it('marks the private apps as private', () => {
    for (const id of ['money', 'people', 'vault', 'health', 'mind', 'compass']) expect(routeById(id).private, id).toBe(true)
    for (const id of ['tasks', 'calendar', 'body', 'learning']) expect(routeById(id).private, id).toBeFalsy()
  })
})

describe('finding a route from a path', () => {
  it('resolves paths, with or without a trailing slash, query or hash', () => {
    expect(routeForPath('/').id).toBe('evergrove')
    expect(routeForPath('/money').id).toBe('money')
    expect(routeForPath('/money/').id).toBe('money')
    expect(routeForPath('/money?x=1#top').id).toBe('money')
    expect(routeForPath('/body').trackerId).toBe('body')
  })

  it('reads Jarvis screens and custom trackers', () => {
    expect(routeForPath('/jarvis/memory')).toMatchObject({ id: 'jarvis', sub: 'memory' })
    expect(routeForPath('/jarvis')).toMatchObject({ id: 'jarvis', sub: null })
    expect(routeForPath('/t/houseplants')).toMatchObject({ custom: true, trackerId: 'houseplants' })
    expect(routeForPath('/t/my%20plants').trackerId).toBe('my plants')
  })

  it('returns null for a path that is not an app', () => {
    expect(routeForPath('/nope')).toBeNull()
    expect(routeForPath('/api/usage')).toBeNull()
  })

  it('names the entry that serves each route, and knows when two paths share one', () => {
    expect(entryPath(routeForPath('/money'))).toBe('/money/')
    expect(entryPath(routeForPath('/'))).toBe('/')
    expect(entryPath(routeForPath('/t/x'))).toBe('/t/')
    expect(sameEntry('/jarvis', '/jarvis/memory')).toBe(true)
    expect(sameEntry('/t/a', '/t/b')).toBe(true)
    expect(sameEntry('/money', '/tasks')).toBe(false)
    expect(sameEntry('/', '/log')).toBe(false)
    expect(sameEntry('/nope', '/money')).toBe(false)
  })

  it('tells the two JavaScript apps apart', () => {
    expect(appOf(routeById('jarvis'))).toBe('jarvis')
    expect(appOf(routeById('money'))).toBe('evergrove')
  })

  it('builds tracker paths, built-in or custom', () => {
    expect(trackerPath('body')).toBe('/body')
    expect(trackerPath('house plants')).toBe('/t/house%20plants')
  })
})

describe('old links keep working (T-P2c)', () => {
  it('maps every old hash link to its new path', () => {
    expect(legacyRedirect('#/app/money')).toBe('/money')
    expect(legacyRedirect('#/app/body')).toBe('/body')
    expect(legacyRedirect('#/app/houseplants')).toBe('/t/houseplants')
    expect(legacyRedirect('#/timeline')).toBe('/log')
    expect(legacyRedirect('#/apps')).toBe('/apps')
    expect(legacyRedirect('#/jarvis')).toBe('/jarvis')
    expect(legacyRedirect('#/jarvis/brief')).toBe('/jarvis/brief')
    expect(legacyRedirect('#/app')).toBe('/apps')
  })

  it('ignores anything that is not an old link', () => {
    expect(legacyRedirect('')).toBeNull()
    expect(legacyRedirect('#top')).toBeNull()
    expect(legacyRedirect('#/')).toBeNull()
    expect(legacyRedirect('#/mystery')).toBeNull()
  })

  it('every old app link that ever existed lands on a real route', () => {
    for (const r of [...ROUTES.filter((x) => x.kind === 'module' || x.kind === 'tracker')]) {
      expect(routeForPath(legacyRedirect(`#/app/${r.id}`))?.id).toBe(r.id)
    }
  })

  it('rewrites old in-app links (Today card items, deep links)', () => {
    expect(normalizeLink('/app/money')).toBe('/money')
    expect(normalizeLink('/app/learning')).toBe('/learning')
    expect(normalizeLink('/timeline')).toBe('/log')
    expect(normalizeLink('/jarvis/brief')).toBe('/jarvis/brief')
    expect(normalizeLink('/')).toBe('/')
    expect(normalizeLink(undefined)).toBe('/')
  })
})

describe('the address a link really goes to', () => {
  it('ends an app page in a slash, which is what its manifest scope expects', () => {
    expect(canonicalPath('/money')).toBe('/money/')
    expect(canonicalPath('/money/')).toBe('/money/')
    expect(canonicalPath('/')).toBe('/')
    expect(canonicalPath('/app/body')).toBe('/body/')
    expect(canonicalPath('/timeline')).toBe('/log/')
  })

  it('keeps Jarvis screens, custom trackers, queries and hashes', () => {
    expect(canonicalPath('/jarvis')).toBe('/jarvis/')
    expect(canonicalPath('/jarvis/memory')).toBe('/jarvis/memory')
    expect(canonicalPath('/t/my%20plants')).toBe('/t/my%20plants')
    expect(canonicalPath('/money?x=1')).toBe('/money/?x=1')
    expect(canonicalPath('/tasks#top')).toBe('/tasks/#top')
  })

  it('leaves anything that is not an app alone', () => {
    expect(canonicalPath('/api/usage')).toBe('/api/usage')
    expect(canonicalPath('https://example.com')).toBe('https://example.com')
  })
})
