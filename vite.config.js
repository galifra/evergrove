import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { build, defineConfig, loadEnv } from 'vite'

// Vercel serves /api/*.js as serverless functions automatically in prod and
// via `vercel dev` locally. Plain `vite dev` doesn't know about that folder
// at all, so this small middleware plugin emulates it for local dev —
// /api/<name> is routed to the matching api/<name>.js handler.
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

          const mod = await server.ssrLoadModule(`/api/${match[1]}.js`)
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

// https://vite.dev/config/
// The service worker imports app code (it builds the evening briefing on the
// device), so it has to be bundled into one classic script at /sw.js. Vite does
// not do that on its own: this plugin builds it after the main build, and serves
// a freshly bundled copy in dev.
async function bundleServiceWorker(write) {
  const result = await build({
    configFile: false,
    publicDir: false,
    logLevel: 'warn',
    define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)) },
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

function serviceWorkerBuild() {
  return {
    name: 'service-worker-build',
    async closeBundle() {
      if (this.meta?.watchMode) return
      await bundleServiceWorker(true)
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

export default defineConfig(({ mode }) => {
  // Make .env values available to the api-dev-middleware's server-side code
  // (Vite only exposes VITE_-prefixed vars to client code by default). This
  // only matters for local `vite dev` — deployed Vercel functions get their
  // env vars injected directly, not through this file.
  const env = loadEnv(mode, process.cwd(), '')
  Object.assign(process.env, env)

  return {
    plugins: [react(), tailwindcss(), apiDevMiddleware(), serviceWorkerBuild()],
  }
})
