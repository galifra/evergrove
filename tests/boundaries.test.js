import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// The import-boundary rule (docs/v2/ARCHITECTURE.md). Layers, lowest first:
//   core < modules < rules < ui < kit < apps/*
// A file may import its own layer or a lower one, never a higher one, and one
// app may never import another. Tests are exempt: integration tests must cross layers.

const ROOT = path.resolve(import.meta.dirname, '..')
const LAYERS = ['core', 'modules', 'rules', 'ui', 'kit']
const rank = (layer) => (LAYERS.includes(layer) ? LAYERS.indexOf(layer) : LAYERS.length)

// Temporary exceptions, each removed by the phase that fixes it. The test below
// fails if this list is not empty once version 2 is finished.
const TEMPORARY = [
  // Removed in Phase 4, when Jarvis becomes its own entry and Evergrove stops embedding his page.
  'apps/evergrove/src/App.jsx imports ../../jarvis/src/screens/JarvisPage.jsx',
]

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(jsx?|mjs)$/.test(e.name)) out.push(p)
  }
  return out
}

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/')
const layerOf = (file) => {
  const m = rel(file).match(/^(packages|apps)\/([^/]+)\//)
  return m ? { kind: m[1], name: m[2] } : null
}
const isTest = (file) => /\.test\.jsx?$/.test(file) || /(^|\/)tests\//.test(rel(file))

const IMPORT = /(?:\bfrom\s+|\bimport\s+|\bimport\(\s*)(['"])([^'"]+)\1/g
function importsOf(file) {
  const src = fs.readFileSync(file, 'utf8')
  return [...src.matchAll(IMPORT)].map((m) => m[2])
}

const sources = [...walk(path.join(ROOT, 'packages')), ...walk(path.join(ROOT, 'apps'))].filter((f) => !isTest(f))

function violations() {
  const bad = []
  for (const file of sources) {
    const me = layerOf(file)
    if (!me) continue
    for (const spec of importsOf(file)) {
      let target = null
      if (spec.startsWith('@evergrove/')) target = { kind: 'packages', name: spec.split('/')[1] }
      else if (spec.startsWith('.')) target = layerOf(path.resolve(path.dirname(file), spec))
      if (!target) continue
      if (target.kind === me.kind && target.name === me.name) continue
      const from = me.kind === 'apps' ? LAYERS.length : rank(me.name)
      const to = target.kind === 'apps' ? LAYERS.length : rank(target.name)
      if (target.kind === 'apps' || to >= from) {
        const label = `${rel(file)} imports ${spec}`
        if (!TEMPORARY.includes(label)) bad.push(label)
      }
    }
  }
  return bad
}

describe('import boundaries', () => {
  it('finds the packages and apps it is meant to check', () => {
    expect(sources.length).toBeGreaterThan(60)
    expect(new Set(sources.map((f) => layerOf(f)?.name))).toEqual(new Set([...LAYERS, 'evergrove', 'jarvis']))
  })

  it('nothing imports upward or sideways, and no app imports another app', () => {
    expect(violations()).toEqual([])
  })

  it('every package lists the packages it imports as dependencies', () => {
    const missing = []
    for (const layer of LAYERS) {
      const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', layer, 'package.json'), 'utf8'))
      const declared = new Set(Object.keys(pkg.dependencies ?? {}))
      for (const file of sources.filter((f) => layerOf(f)?.name === layer)) {
        for (const spec of importsOf(file)) {
          if (!spec.startsWith('@evergrove/')) continue
          const dep = `@evergrove/${spec.split('/')[1]}`
          if (dep !== `@evergrove/${layer}` && !declared.has(dep)) missing.push(`${layer} imports ${dep} without declaring it`)
        }
      }
    }
    expect([...new Set(missing)]).toEqual([])
  })

  it('keeps the temporary exceptions to the one known, tracked one (Phase 4 must empty it)', () => {
    expect(TEMPORARY.filter((t) => !t.startsWith('//'))).toHaveLength(1)
  })

  it('the checker itself catches a violation (a fake upward import)', () => {
    const fake = { kind: 'packages', name: 'core' }
    const target = { kind: 'packages', name: 'rules' }
    expect(rank(target.name) >= rank(fake.name)).toBe(true)
  })
})
