import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { ENTRIES, ROUTES, routeForPath } from '../packages/rules/src/routes.js'
import { allFiles, htmlFile, manifestFile, manifestUrl, renderManifest, scriptSrc, themeColor } from '../scripts/lib/entries.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const read = (f) => fs.readFileSync(path.join(ROOT, f))
const exists = (f) => fs.existsSync(path.join(ROOT, f))

describe('generated app pages, manifests and icons (T-P2a, T-P2e)', () => {
  it('the committed files are exactly what the route table produces (run `npm run gen` if this fails)', () => {
    const stale = allFiles().filter(([file, content]) => {
      if (!exists(file)) return true
      const want = Buffer.isBuffer(content) ? content : Buffer.from(content)
      return !read(file).equals(want)
    })
    expect(stale.map(([f]) => f)).toEqual([])
  })

  it('every route has a page, a manifest, and a page that loads a script that exists', () => {
    for (const route of ENTRIES) {
      expect(exists(htmlFile(route)), `${route.id} page`).toBe(true)
      expect(exists(manifestFile(route)), `${route.id} manifest`).toBe(true)
      const script = path.join(ROOT, path.dirname(htmlFile(route)), scriptSrc(route))
      expect(fs.existsSync(script), `${route.id} script ${scriptSrc(route)}`).toBe(true)
    }
  })

  it('every page links its own manifest and names its own app', () => {
    for (const route of ENTRIES) {
      const html = read(htmlFile(route)).toString()
      expect(html).toContain(`<link rel="manifest" href="${manifestUrl(route)}" />`)
      expect(html).toContain(`<meta name="evergrove-app" content="${route.id}" />`)
      expect(html).toContain(`<meta name="theme-color" content="${themeColor(route)}" />`)
      expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/) // no inline scripts: the strict content policy forbids them
    }
  })

  it('every manifest is valid and installable on its own', () => {
    const ids = new Set()
    for (const route of ENTRIES) {
      const m = JSON.parse(read(manifestFile(route)).toString())
      expect(m.name.length).toBeGreaterThan(0)
      expect(m.short_name.length).toBeGreaterThan(0)
      expect(m.display).toBe('standalone')
      expect(m.start_url.startsWith(m.scope), `${route.id}: start_url inside scope`).toBe(true)
      expect(m.scope.endsWith('/')).toBe(true)
      expect(m.id).toBe(m.scope)
      expect(ids.has(m.id), `${route.id}: duplicate id ${m.id}`).toBe(false)
      ids.add(m.id)
      const sizes = m.icons.filter((i) => i.type === 'image/png').map((i) => i.sizes)
      expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']))
      expect(m.icons.some((i) => i.purpose === 'maskable')).toBe(true)
      for (const icon of m.icons) expect(exists(`public${icon.src}`), `${route.id}: icon ${icon.src}`).toBe(true)
    }
  })

  it("each app's scope does not swallow another app's pages", () => {
    const scopes = ENTRIES.map((r) => JSON.parse(renderManifest(r)).scope)
    for (const a of scopes) for (const b of scopes) if (a !== b && a !== '/') expect(b.startsWith(a), `${b} inside ${a}`).toBe(false)
  })

  it('every icon is a real PNG of the size its name says', () => {
    for (const [file, content] of allFiles()) {
      if (!file.endsWith('.png')) continue
      const buf = Buffer.isBuffer(content) ? content : Buffer.from(content)
      expect([...buf.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
      const size = buf.readUInt32BE(16)
      expect(buf.readUInt32BE(20)).toBe(size)
      expect([180, 192, 512]).toContain(size)
      expect(buf.length).toBeLessThan(20_000)
    }
  })

  it('a path in each route resolves back to that route', () => {
    for (const r of ROUTES) expect(routeForPath(r.path)?.id).toBe(r.id)
  })
})

describe('the hosting rules', () => {
  const vercel = JSON.parse(read('vercel.json').toString())

  it('rewrites serve custom trackers and Jarvis screens from their one page', () => {
    const map = Object.fromEntries(vercel.rewrites.map((r) => [r.source, r.destination]))
    expect(map['/t/:id']).toBe('/t/index.html')
    expect(map['/jarvis/:path+']).toBe('/jarvis/index.html')
  })

  it('keeps the strict security headers on every page', () => {
    const all = vercel.headers.find((h) => h.source === '/(.*)').headers
    const csp = all.find((h) => h.key === 'Content-Security-Policy').value
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(all.find((h) => h.key === 'X-Content-Type-Options').value).toBe('nosniff')
  })

  it('never caches the service worker', () => {
    expect(vercel.headers.find((h) => h.source === '/sw.js').headers[0].value).toBe('no-cache')
  })

  it('keeps both scheduled reminder jobs', () => {
    expect(vercel.crons.map((c) => c.schedule).sort()).toEqual(['0 2 * * *', '0 3 * * *'])
  })
})
