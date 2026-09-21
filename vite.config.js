import fs from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { build, defineConfig, loadEnv } from 'vite'
import { ENTRIES } from './packages/rules/src/routes.js'

// `/money` (no slash) is served by money/index.html, as Vercel does in production.
const ENTRY_DIRS = new Set(ENTRIES.filter((r) => r.path !== '/').map((r) => r.path))

const ROOT = import.meta.dirname

// Vercel serves /api/*.js as serverless functions in production. Plain `vite dev`
// doesn't know about that folder, so this small plugin emulates it for local
// dev: /api/<name> is routed to the matching api/<name>.js handler.
function apiDevMiddleware() {
  return {
    name: 'api-dev-middleware',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const match = req.url?.match(/^\/api\/([a-z-]+)(?:\?.*)?$/)
        if (!match) {
          next()
          return
        }
        try {
          const chunks = []
          for await (const chunk of req) chunks.push(chunk)
          const raw = Buffer.concat(chunks).toString('utf8')
          req.body = raw ? JSON.parse(raw) : {}

          res.status = (code) => {
            res.statusCode = code
            return res
          }
          res.json = (obj) => {
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(obj))
          }

          const mod = await server.ssrLoadModule(path.join(ROOT, 'api', `${match[1]}.js`))
          await mod.default(req, res)
        } catch (err) {
          console.error('[api-dev-middleware]', err)
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Local API middleware error' }))
        }
      })
    },
  }
}

// The generated pages live under `site/` but load their script from `../apps/<app>/src/main.jsx`, which a
// browser turns into `/apps/...`, a place outside the dev server's root. The build follows the file path;
// the dev server needs telling. (Without this `npm run dev` served a blank page.)
function devSourceRewrites() {
  return {
    name: 'dev-source-rewrites',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (/^\/(apps|packages)\//.test(req.url ?? '')) req.url = `/@fs/${ROOT.split(path.sep).join('/')}${req.url}`
        next()
      })
    },
  }
}

// Screens inside Jarvis (/jarvis/memory) and custom trackers (/t/<id>) have no
// file of their own: the same page serves them. Production does this with
// rewrites in vercel.json; this plugin does the same for dev and preview.
function entryRewrites() {
  const rewrite = (req, _res, next) => {
    const url = req.url ?? ''
    const [pathname, query = ''] = url.split('?')
    const q = query ? `?${query}` : ''
    if (ENTRY_DIRS.has(pathname)) req.url = `${pathname}/index.html${q}`
    else if (/^\/jarvis\/[^.]+$/.test(pathname)) req.url = `/jarvis/index.html${q}`
    else if (/^\/t\/[^/.]+\/?$/.test(pathname)) req.url = `/t/index.html${q}`
    next()
  }
  return {
    name: 'entry-rewrites',
    // (No return value: Vite would call a returned function as a post-hook.)
    configureServer(server) {
      server.middlewares.use(rewrite)
    },
    configurePreviewServer(server) {
      server.middlewares.use(rewrite)
    },
  }
}

// The service worker imports app code (it builds the evening briefing on the
// device), so it has to be bundled into one classic script at /sw.js. Vite does
// not do that on its own: this plugin builds it after the main build, listing
// every built file so any app can open offline, and serves a fresh copy in dev.
async function bundleServiceWorker(write, precache = []) {
  const result = await build({
    configFile: false,
    publicDir: false,
    logLevel: 'warn',
    root: ROOT,
    define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)), __PRECACHE__: JSON.stringify(precache) },
    build: {
      write,
      outDir: 'dist',
      emptyOutDir: false,
      minify: true,
      lib: { entry: 'packages/kit/src/sw/sw.js', formats: ['iife'], name: 'EvergroveSW', fileName: () => 'sw.js' },
    },
  })
  const out = Array.isArray(result) ? result[0] : result
  return out.output?.[0]?.code
}

// URLs the worker keeps ready: every page, script, style, manifest and icon that was built.
function precacheList(dist) {
  const out = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else {
        const rel = path.relative(dist, full).split(path.sep).join('/')
        if (rel === 'sw.js' || rel === '404.html') continue
        out.push(rel === 'index.html' ? '/' : rel.endsWith('/index.html') ? `/${rel.slice(0, -'index.html'.length)}` : `/${rel}`)
      }
    }
  }
  walk(dist)
  return out.sort()
}

function serviceWorkerBuild() {
  return {
    name: 'service-worker-build',
    async closeBundle() {
      if (this.meta?.watchMode) return
      await bundleServiceWorker(true, precacheList(path.join(ROOT, 'dist')))
    },
    configureServer(server) {
      server.middlewares.use('/sw.js', async (req, res) => {
        try {
          const code = await bundleServiceWorker(false)
          res.setHeader('Content-Type', 'text/javascript')
          res.setHeader('Cache-Control', 'no-cache')
          res.end(code)
        } catch (err) {
          console.error('[service-worker-build]', err)
          res.statusCode = 500
          res.end('service worker failed to build')
        }
      })
    },
  }
}

// One entry page per app, all sharing chunks (see docs/v2/ARCHITECTURE.md).
const input = Object.fromEntries([
  ...ENTRIES.map((r) => [r.id, path.join(ROOT, 'site', r.path === '/' ? '' : r.path.slice(1), 'index.html')]),
  ['not-found', path.join(ROOT, 'site', '404.html')],
])

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Make .env values available to the api-dev-middleware's server-side code
  // (Vite only exposes VITE_-prefixed vars to client code by default). This
  // only matters for local `vite dev`; deployed functions get their env vars
  // injected directly, not through this file.
  const env = loadEnv(mode, ROOT, '')
  Object.assign(process.env, env)

  return {
    root: path.join(ROOT, 'site'),
    publicDir: path.join(ROOT, 'public'),
    appType: 'mpa',
    plugins: [react(), tailwindcss(), apiDevMiddleware(), devSourceRewrites(), entryRewrites(), serviceWorkerBuild()],
    server: { fs: { allow: [ROOT] } },
    build: {
      outDir: path.join(ROOT, 'dist'),
      emptyOutDir: true,
      rollupOptions: { input },
    },
  }
})
