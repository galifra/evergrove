// The health check, in one command (P10.5). It has two halves.
//
//   node scripts/health.mjs                    the local half: tests, lint, generated files, build, audit
//   node scripts/health.mjs --url <address>    the live half: a real request to every path of a running site
//   node scripts/health.mjs --url <address> --local     both
//
// The live half needs no login and changes nothing: it only reads pages, manifests and headers, and
// makes one request to each API without a code to prove the gate is shut. Use it on a preview address
// before a cutover and on the live address after one. The routing eval and the tone samples cost real
// money, so they are separate (`npm run eval`, `npm run tone`, `npm run feedback`) and are listed at the
// end as a reminder rather than run here.
import { spawnSync, execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ENTRIES, entryPath } from '../packages/rules/src/routes.js'
import { manifestUrl } from './lib/entries.mjs'

const args = process.argv.slice(2)
const urlIndex = args.indexOf('--url')
const base = urlIndex >= 0 ? String(args[urlIndex + 1] ?? '').replace(/\/+$/, '') : ''
// A Vercel preview address is behind the owner's login; --via-vercel sends each request through `vercel curl`, which signs in for it.
const viaVercel = args.includes('--via-vercel')
const runLocal = args.includes('--local') || !base
const runLive = !!base

const results = []
const record = (ok, name, detail = '') => {
  results.push({ ok, name, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}
const skip = (name, why) => console.log(`skip  ${name}  (${why})`)

// ---- the local half --------------------------------------------------------------------------

function step(name, command, commandArgs, { allowNonZero = false } = {}) {
  const started = Date.now()
  const r = spawnSync(command, commandArgs, { encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  const ok = r.status === 0 || allowNonZero
  const summary = (out.match(/Tests\s+[^\n]*/) ?? out.match(/found \d+ vulnerabilities/) ?? out.match(/built in [^\n]*/) ?? [''])[0].replace(/\x1b\[[0-9;]*m/g, '').trim()
  record(ok, name, `${summary ? `${summary}, ` : ''}${seconds}s`)
  if (!ok) console.log(out.split('\n').slice(-25).join('\n'))
}

if (runLocal) {
  console.log('\nLocal checks\n')
  step('generated pages and manifests are current', 'node', ['scripts/gen-entries.mjs', '--check'])
  step('tests', 'npx', ['vitest', 'run'])
  step('lint (no errors; warnings are listed by `npx oxlint`)', 'npx', ['oxlint'])
  step('build', 'npm', ['run', 'build'])
  step('dependency audit', 'npm', ['audit', '--audit-level=high'])
}

// ---- the live half ---------------------------------------------------------------------------

async function get(urlPath, options = {}) {
  const started = Date.now()
  if (!viaVercel) {
    const res = await fetch(base + urlPath, { redirect: 'manual', ...options })
    return { res, ms: Date.now() - started }
  }
  // The same request through `vercel curl`, wrapped so the rest of the script cannot tell the difference.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-'))
  const hdrFile = path.join(dir, 'h')
  const bodyFile = path.join(dir, 'b')
  const curlArgs = ['-s', '-D', hdrFile, '-o', bodyFile, '-w', '%{http_code}']
  if (options.method && options.method !== 'GET') curlArgs.push('-X', options.method)
  for (const [k, v] of Object.entries(options.headers ?? {})) curlArgs.push('-H', `${k}: ${v}`)
  if (options.body) curlArgs.push('-d', options.body)
  const code = await new Promise((resolve, reject) =>
    // On Windows the arguments go through a shell, so any that contain a space or a brace are quoted.
    execFile('npx', ['vercel', 'curl', urlPath, '--deployment', base, '--', ...curlArgs].map((a) => (process.platform === 'win32' && /[\s{}]/.test(a) ? `"${a}"` : a)), { shell: process.platform === 'win32', env: { ...process.env, MSYS_NO_PATHCONV: '1' }, timeout: 60000 }, (err, stdout) => {
      if (err && !stdout) reject(err)
      else resolve(Number((stdout.match(/(\d{3})\s*$/) ?? [])[1] ?? 0))
    })
  )
  const headers = new Map()
  if (fs.existsSync(hdrFile)) for (const line of fs.readFileSync(hdrFile, 'utf8').split(/\r?\n/)) { const i = line.indexOf(':'); if (i > 0) headers.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim()) }
  const body = fs.existsSync(bodyFile) ? fs.readFileSync(bodyFile, 'utf8') : ''
  fs.rmSync(dir, { recursive: true, force: true })
  const res = { status: code, headers: { get: (k) => headers.get(k.toLowerCase()) ?? null }, text: async () => body, json: async () => JSON.parse(body) }
  return { res, ms: Date.now() - started }
}

const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(base)
const needHeaders = (res) => {
  const csp = res.headers.get('content-security-policy') ?? ''
  const missing = []
  if (!/script-src 'self'(;|$)/.test(csp) || /script-src[^;]*unsafe/.test(csp)) missing.push('strict script policy')
  if (!/frame-ancestors 'none'/.test(csp)) missing.push('frame-ancestors')
  if (res.headers.get('x-content-type-options') !== 'nosniff') missing.push('nosniff')
  if (!res.headers.get('referrer-policy')) missing.push('referrer-policy')
  return missing
}

async function live() {
  console.log(`\nLive checks on ${base}\n`)
  if (isLocalhost) skip('security headers', 'they are set by the host, not by a local preview')
  let slow = 0
  for (const route of ENTRIES) {
    const path = entryPath(route)
    try {
      const { res, ms } = await get(path === '/t/' ? '/t/anything' : path)
      const html = res.status === 200 ? await res.text() : ''
      const problems = []
      if (res.status !== 200) problems.push(`status ${res.status}`)
      else {
        if (!html.includes(`<meta name="evergrove-app" content="${route.id}"`)) problems.push('page names a different app')
        if (!html.includes(`href="${manifestUrl(route)}"`)) problems.push('its own manifest is not linked')
        if (/<script(?![^>]*\bsrc=)[^>]*>/.test(html)) problems.push('an inline script')
        // The security headers come from the host's configuration (vercel.json), so a local preview has none to check.
        if (!isLocalhost) problems.push(...needHeaders(res).map((m) => `missing ${m}`))
      }
      if (ms > 3000) slow += 1
      record(problems.length === 0, `${path}`, problems.join('; ') || `${route.id}, ${ms}ms`)

      // The manifest of the same app.
      const m = await get(manifestUrl(route))
      let manifestProblem = m.res.status === 200 ? '' : `status ${m.res.status}`
      if (!manifestProblem) {
        const json = await m.res.json().catch(() => null)
        if (!json?.name || !json?.icons?.length) manifestProblem = 'not a usable manifest'
        else if (!String(json.scope ?? '').startsWith('/')) manifestProblem = 'no scope'
        else if (!/manifest\+json|json/.test(m.res.headers.get('content-type') ?? '')) manifestProblem = 'wrong content type'
      }
      record(!manifestProblem, `${manifestUrl(route)}`, manifestProblem)
    } catch (err) {
      record(false, path, err.message)
    }
  }

  // An address without its trailing slash still finds the right page (a redirect or the page itself).
  for (const [bare, id] of [['/money', 'money'], ['/jarvis', 'jarvis'], ['/tasks', 'tasks']]) {
    try {
      let { res } = await get(bare)
      if (res.status >= 300 && res.status < 400) res = (await get(new URL(res.headers.get('location'), base + bare).pathname)).res
      const html = res.status === 200 ? await res.text() : ''
      record(res.status === 200 && html.includes(`content="${id}"`), `${bare} (no slash)`, `status ${res.status}`)
    } catch (err) {
      record(false, `${bare} (no slash)`, err.message)
    }
  }

  // Jarvis's deep addresses all land on Jarvis's page.
  for (const sub of ['memory', 'weekly', 'settings', 'brief']) {
    try {
      const { res } = await get(`/jarvis/${sub}`)
      const html = res.status === 200 ? await res.text() : ''
      record(res.status === 200 && html.includes('content="jarvis"'), `/jarvis/${sub}`, `status ${res.status}`)
    } catch (err) {
      record(false, `/jarvis/${sub}`, err.message)
    }
  }

  try {
    const { res } = await get('/sw.js')
    const cc = res.headers.get('cache-control') ?? ''
    record(res.status === 200 && /no-cache|max-age=0/.test(cc), '/sw.js is served fresh', `status ${res.status}, ${cc || 'no cache-control'}`)
  } catch (err) {
    record(false, '/sw.js', err.message)
  }

  // The gate: with an access code set, an API asked without one must say no. Nothing is changed.
  if (isLocalhost) {
    skip('API access-code gate', 'a local preview serves no API')
  } else {
    for (const path of ['/api/usage', '/api/jarvis', '/api/parse-entry', '/api/sync']) {
      try {
        const { res } = await get(path, { method: path === '/api/usage' ? 'GET' : 'POST', headers: { 'content-type': 'application/json' }, body: path === '/api/usage' ? undefined : '{}' })
        record([401, 403].includes(res.status), `${path} refuses a request with no code`, `status ${res.status}`)
      } catch (err) {
        record(false, path, err.message)
      }
    }
  }
  if (slow) console.log(`note: ${slow} page(s) took more than 3 seconds`)
}

if (runLive) await live()

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length} of ${results.length} checks passed.`)
if (failed.length) {
  console.log('\nFailed:')
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ''}`)
}
console.log('\nNot run here (they cost real money, so run them on purpose): npm run eval, npm run tone, npm run feedback, npm run measure')
process.exit(failed.length ? 1 : 0)
