import { Redis } from '@upstash/redis'

// Real Upstash Redis when its env vars exist (production), otherwise a small
// in-memory stand-in so local dev and tests work with no external services.
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)))

function createMemoryKv() {
  const data = new Map()
  const expires = new Map()
  const alive = (k) => {
    if (expires.has(k) && expires.get(k) <= Date.now()) {
      data.delete(k)
      expires.delete(k)
    }
  }
  return {
    async get(k) {
      alive(k)
      return clone(data.get(k) ?? null)
    },
    async set(k, v, opts) {
      data.set(k, clone(v))
      if (opts?.ex) expires.set(k, Date.now() + opts.ex * 1000)
      else expires.delete(k)
      return 'OK'
    },
    async del(k) {
      data.delete(k)
      return 1
    },
    async incrbyfloat(k, by) {
      const next = Number(data.get(k) ?? 0) + by
      data.set(k, next)
      return next
    },
    async rpush(k, ...vals) {
      const list = data.get(k) ?? []
      list.push(...vals.map(clone))
      data.set(k, list)
      return list.length
    },
    async lrange(k, start, stop) {
      const list = data.get(k) ?? []
      const end = stop === -1 ? list.length : stop + 1
      return clone(list.slice(start, end))
    },
    async sadd(k, ...vals) {
      const set = data.get(k) ?? new Set()
      let added = 0
      for (const v of vals) {
        if (!set.has(v)) {
          set.add(v)
          added += 1
        }
      }
      data.set(k, set)
      return added
    },
  }
}

const memoryKv = createMemoryKv()
let realKv = null

export function getKv() {
  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN
  if (!url || !token) return memoryKv
  realKv ??= new Redis({ url, token })
  return realKv
}
