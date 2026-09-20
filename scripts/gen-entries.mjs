// Writes the generated pages, manifests and icons from the route table.
//   node scripts/gen-entries.mjs          write everything
//   node scripts/gen-entries.mjs --check  fail if any file is missing or out of date
import fs from 'node:fs'
import path from 'node:path'
import { allFiles } from './lib/entries.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const check = process.argv.includes('--check')
let stale = 0
let written = 0
for (const [file, content] of allFiles()) {
  const full = path.join(ROOT, file)
  const want = Buffer.isBuffer(content) ? content : Buffer.from(content)
  const have = fs.existsSync(full) ? fs.readFileSync(full) : null
  if (have && have.equals(want)) continue
  if (check) {
    console.error(`out of date: ${file}`)
    stale++
    continue
  }
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, want)
  written++
}
if (check) {
  if (stale) {
    console.error(`${stale} generated file(s) are out of date. Run: node scripts/gen-entries.mjs`)
    process.exit(1)
  }
  console.log('generated files are up to date')
} else {
  console.log(`wrote ${written} file(s)`)
}
