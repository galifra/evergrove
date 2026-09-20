import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { canonicalPath, normalizeLink } from '../packages/rules/src/routes.js'

// The same-address design (P10.2): every app lives on one origin, so one script problem would reach
// every app's data. These are the standing guards against that: no way to run text as code, a strict
// content policy, the access-code gate on every server route, and links that can only go inward.

const ROOT = path.resolve(import.meta.dirname, '..')
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')

function sourceFiles(dir, out = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) sourceFiles(rel, out)
    else if (/\.(jsx?|mjs)$/.test(e.name) && !/\.test\.jsx?$/.test(e.name)) out.push(rel)
  }
  return out
}

describe('nothing turns text into code or markup', () => {
  const files = [...sourceFiles('apps'), ...sourceFiles('packages'), ...sourceFiles('site'), ...sourceFiles('server'), ...sourceFiles('api')]
  const SINKS = [
    [/dangerouslySetInnerHTML/, 'dangerouslySetInnerHTML'],
    [/\.(inner|outer)HTML\s*=/, 'innerHTML / outerHTML assignment'],
    [/insertAdjacentHTML/, 'insertAdjacentHTML'],
    [/document\.write\s*\(/, 'document.write'],
    [/\beval\s*\(/, 'eval'],
    [/new\s+Function\s*\(/, 'new Function'],
    [/javascript:/i, 'a script address'],
    [/\bsrcDoc\b/, 'srcDoc'],
    [/window\.open\s*\(/, 'window.open'],
  ]

  it('finds the source it is meant to check', () => {
    expect(files.length).toBeGreaterThan(80)
  })

  for (const [re, label] of SINKS) {
    it(`no ${label} anywhere in the source`, () => {
      const hits = files.filter((f) => re.test(read(f)) && !/security\.test/.test(f))
      expect(hits, `found in ${hits.join(', ')}`).toEqual([])
    })
  }

  it('the checker itself catches a sink (it is not silently passing)', () => {
    expect(/dangerouslySetInnerHTML/.test('<div dangerouslySetInnerHTML={{ __html: x }} />')).toBe(true)
    expect(/\beval\s*\(/.test('eval(x)')).toBe(true)
  })
})

describe('the content policy stays strict', () => {
  const config = JSON.parse(read('vercel.json'))
  const csp = config.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy').value
  const directive = (name) => (csp.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${name} `)) ?? '').split(/\s+/).slice(1)

  it('runs only scripts from this address: no inline, no eval, no other host', () => {
    expect(directive('script-src')).toEqual(["'self'"])
    expect(directive('default-src')).toEqual(["'self'"])
  })

  it('cannot talk to any other server, load plugins, be framed, or change where forms go', () => {
    expect(directive('connect-src')).toEqual(["'self'"])
    expect(directive('object-src')).toEqual(["'none'"])
    expect(directive('frame-ancestors')).toEqual(["'none'"])
    expect(directive('form-action')).toEqual(["'self'"])
    expect(directive('base-uri')).toEqual(["'self'"])
  })

  it('the only outside hosts are the two font hosts', () => {
    const hosts = csp.match(/https?:\/\/[^\s;]+/g) ?? []
    expect(hosts.sort()).toEqual(['https://fonts.googleapis.com', 'https://fonts.gstatic.com'])
  })

  it('every response also carries the standard hardening headers', () => {
    const all = config.headers.find((h) => h.source === '/(.*)').headers.map((h) => h.key)
    for (const k of ['X-Content-Type-Options', 'Referrer-Policy', 'X-Frame-Options', 'Permissions-Policy']) expect(all).toContain(k)
  })

  it('the service worker is never cached hard, so a fix can always replace it', () => {
    const sw = config.headers.find((h) => h.source === '/sw.js')
    expect(sw.headers).toContainEqual({ key: 'Cache-Control', value: 'no-cache' })
  })
})

describe('every server route is behind the access code', () => {
  const routes = fs.readdirSync(path.join(ROOT, 'api')).filter((f) => f.endsWith('.js'))

  it('finds the routes', () => {
    expect(routes.sort()).toEqual(['jarvis.js', 'parse-entry.js', 'save-subscription.js', 'send-reminder.js', 'sync.js', 'usage.js'])
  })

  for (const file of routes) {
    it(`api/${file} checks the code (or, for the scheduled job, the cron secret) before it does anything`, () => {
      // Only the code that runs matters here, not the import lines at the top.
      const src = read(`api/${file}`).split(String.fromCharCode(10)).filter((l) => !l.startsWith('import ')).join(String.fromCharCode(10))
      const gate = file === 'send-reminder.js' ? /checkCronSecret\(|authorize\(/ : /authorize\(/
      const at = src.search(gate)
      expect(at, 'no gate found').toBeGreaterThan(-1)
      // the gate comes before any model call, store read or write
      const firstWork = src.search(/new Anthropic|getKv\(|webpush|kv\.|\bfetch\(/)
      if (firstWork > -1) expect(at).toBeLessThan(firstWork)
    })
  }

  it('the service worker never caches an API answer', () => {
    const sw = read('packages/kit/src/sw/sw.js')
    expect(sw).toMatch(/pathname\.startsWith\('\/api\/'\)/)
  })
})

describe('links can only go inward', () => {
  it('a link that is not a path on this address becomes the home page', () => {
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'https://evil.example/', '//evil.example', '/\\evil.example', 'data:text/html,x', '', null, undefined, 42, '/ok\nnext', '\\\\host']) {
      expect(normalizeLink(bad), String(bad)).toBe('/')
      expect(canonicalPath(bad), String(bad)).toBe('/')
    }
  })

  it('real inward links are left alone', () => {
    expect(canonicalPath('/money')).toBe('/money/')
    expect(canonicalPath('/jarvis/memory')).toBe('/jarvis/memory')
    expect(canonicalPath('/app/tasks')).toBe('/tasks/')
    expect(canonicalPath('/log?q=milk')).toBe('/log/?q=milk')
  })
})
