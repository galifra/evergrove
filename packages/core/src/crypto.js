// WebCrypto helpers: passphrase -> AES-GCM key, JSON encrypt/decrypt.
// Used for device sync (key never leaves the device) and for the vault.

const enc = new TextEncoder()
const dec = new TextDecoder()

function toB64(bytes) {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function fromB64(str) {
  const s = atob(str)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function deriveKey(passphrase, salt = 'evergrove-sync-v1', iterations = 200_000) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  )
  const raw = await crypto.subtle.exportKey('raw', key)
  const idBytes = new Uint8Array(raw.byteLength + 8)
  idBytes.set(new Uint8Array(raw))
  idBytes.set(enc.encode('vault-id'), raw.byteLength)
  const vaultId = toHex(await crypto.subtle.digest('SHA-256', idBytes)).slice(0, 32)
  return { key, vaultId }
}

export async function encryptJson(key, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(value)))
  return { iv: toB64(iv), ct: toB64(new Uint8Array(ct)) }
}

export async function decryptJson(key, { iv, ct }) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, key, fromB64(ct))
  return JSON.parse(dec.decode(plain))
}
