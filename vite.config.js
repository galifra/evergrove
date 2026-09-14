import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'

// Vercel serves /api/*.js as serverless functions automatically in prod and
// via `vercel dev` locally. Plain `vite dev` doesn't know about that folder
// at all, so this small middleware plugin emulates it for local dev — POST
// /api/parse-entry is routed to the same handler that runs in production.
function apiDevMiddleware() {
  return {
    name: 'api-dev-middleware',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/parse-entry') || req.method !== 'POST') {
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

          const mod = await server.ssrLoadModule('/api/parse-entry.js')
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
export default defineConfig(({ mode }) => {
  // Make .env values available to the api-dev-middleware's server-side code
  // (Vite only exposes VITE_-prefixed vars to client code by default). This
  // only matters for local `vite dev` — deployed Vercel functions get their
  // env vars injected directly, not through this file.
  const env = loadEnv(mode, process.cwd(), '')
  Object.assign(process.env, env)

  return {
    plugins: [react(), tailwindcss(), apiDevMiddleware()],
  }
})
