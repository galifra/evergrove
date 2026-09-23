// Turns the route table into everything an app address needs: an HTML page, a
// manifest, and icons. Pure functions (no file writes) so a test can check the
// committed files are exactly what the route table says.
import { deflateSync } from 'node:zlib'
import { ENTRIES, appOf } from '../../packages/rules/src/routes.js'

export const BASE_BG = '#0d1912'

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const rgbToHex = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
export const mix = (a, b, t) => rgbToHex(hexToRgb(a).map((v, i) => v * (1 - t) + hexToRgb(b)[i] * t))

// The colour of the browser bar for an app: its own colour, pulled well toward the dark background.
export const themeColor = (route) => (route.id === 'evergrove' ? BASE_BG : mix(route.color, BASE_BG, 0.82))

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

// Where each thing lives. The mother app keeps its long-standing manifest and icon addresses.
export const isHome = (route) => route.id === 'evergrove'
export const dirOf = (route) => (route.path === '/' ? '' : route.path.slice(1))
export const htmlFile = (route) => (route.path === '/' ? 'site/index.html' : `site/${dirOf(route)}/index.html`)
export const manifestUrl = (route) => (isHome(route) ? '/manifest.json' : `${route.path}/manifest.webmanifest`)
// Manifests live in public/ so their addresses stay exactly as written (Vite renames files it treats as assets).
export const manifestFile = (route) => (isHome(route) ? 'public/manifest.json' : `public/${dirOf(route)}/manifest.webmanifest`)
export const iconUrl = (route, size) => (isHome(route) ? { 180: '/apple-touch-icon.png', 192: '/icon-192.png', 512: '/icon-512.png', maskable: '/icon-maskable-512.png' }[size] : `/icons/${route.id}-${size}.png`)
export const svgUrl = (route) => (isHome(route) ? '/tree-icon.svg' : `/icons/${route.id}.svg`)
const scopeOf = (route) => (route.custom ? '/t/' : route.path === '/' ? '/' : `${route.path}/`)

export function scriptSrc(route) {
  const depth = route.path === '/' ? 0 : route.path.slice(1).split('/').length
  const up = '../'.repeat(depth + 1)
  return `${up}apps/${appOf(route)}/src/main.jsx`
}

export function renderHtml(route) {
  const title = isHome(route) ? 'Evergrove' : route.id === 'jarvis' ? 'MOXIE' : `${route.name} · Evergrove`
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="${svgUrl(route)}" />
    <link rel="apple-touch-icon" href="${iconUrl(route, 180)}" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="${esc(route.short)}" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <link rel="manifest" href="${manifestUrl(route)}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="${themeColor(route)}" />
    <meta name="description" content="${esc(route.description)}" />
    <meta name="evergrove-app" content="${route.id}" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,500&family=Inter:wght@400;500;600;700&display=swap"
      rel="stylesheet"
    />
    <title>${esc(title)}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="${scriptSrc(route)}"></script>
  </body>
</html>
`
}

export function renderManifest(route) {
  const scope = scopeOf(route)
  const manifest = {
    name: isHome(route) ? 'Evergrove' : route.id === 'jarvis' ? 'MOXIE' : `${route.name} · Evergrove`,
    short_name: route.short,
    description: route.description,
    id: scope,
    start_url: scope,
    scope,
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: BASE_BG,
    theme_color: themeColor(route),
    icons: [
      { src: iconUrl(route, 192), sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: iconUrl(route, 512), sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: iconUrl(route, 'maskable'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: svgUrl(route), sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  }
  if (isHome(route)) {
    manifest.description = 'A living skill tree that grows with everything you do, with MOXIE to run it.'
    manifest.shortcuts = [
      { name: 'Talk to MOXIE', url: '/moxie/' },
      { name: 'Apps', url: '/apps/' },
    ]
  }
  return JSON.stringify(manifest, null, 2) + '\n'
}

// ---- icons ---------------------------------------------------------------

const FONT = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  G: ['.####', '#....', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
}

export const initialOf = (route) => route.short.trim()[0].toUpperCase()

// The letter as filled cells: [{x, y}] on a 5 x 7 grid.
function glyphCells(letter) {
  const rows = FONT[letter]
  if (!rows) return null
  const cells = []
  rows.forEach((row, y) => [...row].forEach((c, x) => c === '#' && cells.push({ x, y })))
  return cells
}

const INK = '#0b140f'

// Returns RGBA pixels. `kind`: "any" (rounded corners), "full" (square, for maskable and iOS).
export function renderIcon(route, size, kind = 'any') {
  const bg = hexToRgb(route.color)
  const ink = hexToRgb(INK)
  const px = new Uint8Array(size * size * 4)
  const radius = kind === 'any' ? size * 0.22 : 0
  const cells = glyphCells(initialOf(route))
  const glyphH = size * (kind === 'any' ? 0.5 : 0.4)
  const unit = Math.max(1, Math.floor(glyphH / 7))
  const gw = 5 * unit
  const gh = 7 * unit
  const ox = Math.floor((size - gw) / 2)
  const oy = Math.floor((size - gh) / 2)
  const ink1 = new Set()
  if (cells) for (const c of cells) for (let dy = 0; dy < unit; dy++) for (let dx = 0; dx < unit; dx++) ink1.add((oy + c.y * unit + dy) * size + (ox + c.x * unit + dx))
  const inRounded = (x, y) => {
    if (!radius) return true
    const cx = x < radius ? radius : x > size - 1 - radius ? size - 1 - radius : x
    const cy = y < radius ? radius : y > size - 1 - radius ? size - 1 - radius : y
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2
  }
  const dot = (x, y) => (x - size / 2) ** 2 + (y - size / 2) ** 2 <= (size * 0.16) ** 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      if (!inRounded(x, y)) continue
      const isInk = cells ? ink1.has(y * size + x) : dot(x, y)
      const c = isInk ? ink : bg
      px[i] = c[0]
      px[i + 1] = c[1]
      px[i + 2] = c[2]
      px[i + 3] = 255
    }
  }
  return px
}

let crcTable
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

export function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    Buffer.from(rgba.buffer, rgba.byteOffset + y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1)
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

export function renderSvg(route) {
  const cells = glyphCells(initialOf(route))
  const u = 36
  const gx = (512 - 5 * u) / 2
  const gy = (512 - 7 * u) / 2
  const squares = cells ? cells.map((c) => `<rect x="${gx + c.x * u}" y="${gy + c.y * u}" width="${u}" height="${u}"/>`).join('') : '<circle cx="256" cy="256" r="80"/>'
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="${route.color}"/><g fill="${INK}">${squares}</g></svg>\n`
}

// Every file the generator owns: [path, content (string or Buffer)].
export function allFiles() {
  const files = []
  for (const route of ENTRIES) {
    files.push([htmlFile(route), renderHtml(route)])
    files.push([manifestFile(route), renderManifest(route)])
    if (isHome(route)) continue
    files.push([`public/icons/${route.id}.svg`, renderSvg(route)])
    for (const [name, size, kind] of [['180', 180, 'full'], ['192', 192, 'any'], ['512', 512, 'any'], ['maskable', 512, 'full']]) {
      files.push([`public/icons/${route.id}-${name}.png`, encodePng(size, renderIcon(route, size, kind))])
    }
  }
  return files
}
