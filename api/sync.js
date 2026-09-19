import { checkAppCode } from '../server/auth.js'
import { getKv } from '../server/store.js'

// End-to-end encrypted relay. The server only ever sees {id, iv, ct}; it can
// order and dedupe events but cannot read them.
const VAULT_RE = /^[0-9a-f]{32}$/
const MAX_ITEMS_PER_PUSH = 100
const MAX_ITEM_BYTES = 24_000
const MAX_PULL = 500
const MAX_LOG_LENGTH = 200_000

function keys(vaultId) {
  return { list: `evergrove:log:${vaultId}`, ids: `evergrove:ids:${vaultId}` }
}

export default async function handler(req, res) {
  if (!checkAppCode(req)) {
    res.status(401).json({ error: 'Invalid app code.' })
    return
  }
  const kv = getKv()

  if (req.method === 'POST') {
    const { vaultId, items } = req.body || {}
    if (!VAULT_RE.test(vaultId || '') || !Array.isArray(items) || items.length > MAX_ITEMS_PER_PUSH) {
      res.status(400).json({ error: 'Bad sync request.' })
      return
    }
    const k = keys(vaultId)
    let accepted = 0
    let length = 0
    for (const item of items) {
      if (
        !item ||
        typeof item.id !== 'string' ||
        typeof item.iv !== 'string' ||
        typeof item.ct !== 'string' ||
        item.id.length > 200 ||
        JSON.stringify(item).length > MAX_ITEM_BYTES
      ) {
        continue
      }
      const isNew = await kv.sadd(k.ids, item.id)
      if (!isNew) continue
      length = await kv.rpush(k.list, { id: item.id, iv: item.iv, ct: item.ct })
      accepted += 1
      if (length > MAX_LOG_LENGTH) break
    }
    res.status(200).json({ ok: true, accepted })
    return
  }

  if (req.method === 'GET') {
    const url = new URL(req.url, 'http://local')
    const vaultId = url.searchParams.get('vaultId') || ''
    const after = Math.max(0, parseInt(url.searchParams.get('after') || '0', 10) || 0)
    if (!VAULT_RE.test(vaultId)) {
      res.status(400).json({ error: 'Bad sync request.' })
      return
    }
    const items = await kv.lrange(keys(vaultId).list, after, after + MAX_PULL - 1)
    res.status(200).json({ items, next: after + items.length })
    return
  }

  res.status(405).json({ error: 'Method not allowed' })
}
