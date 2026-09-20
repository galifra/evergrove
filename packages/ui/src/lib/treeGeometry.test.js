import { describe, it, expect } from 'vitest'
import { buildTree } from './treeGeometry'
import { DOMAINS } from '@evergrove/core/lib/domains.js'
import { levelFromXp } from '@evergrove/core/lib/treeEngine.js'

// The tree is drawn from these numbers, so testing them is testing the picture
// (backlog T2.5): the same data always draws the same tree, it grows as you do,
// and even a maxed-out tree stays inside the frame.

const skill = (id, xp) => ({ id, name: id, xp, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' })
const state = (skills) => ({ skills })

const STAGES = {
  seed: state({}),
  sprout: state({ health: { running: skill('running', 60) } }),
  sapling: state({ health: { running: skill('running', 200) }, mind: { reading: skill('reading', 120) }, social: { talk: skill('talk', 70) } }),
  mature: state(Object.fromEntries(DOMAINS.map((d) => [d.id, { a: skill('a', 900), b: skill('b', 500), c: skill('c', 250) }]))),
  ancient: state(Object.fromEntries(DOMAINS.map((d) => [d.id, Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`s${i}`, skill(`s${i}`, 6000)]))]))),
}

const summary = (t) => ({
  trunkHeight: Math.round(t.trunk.y1 - t.trunk.y2),
  branches: t.branches.length,
  dormant: t.branches.filter((b) => b.dormant).length,
  twigs: t.twigs.length,
  leaves: t.leaves.length,
  blooms: t.leaves.filter((l) => l.bloom).length,
})

describe('drawing the tree', () => {
  it('is deterministic: identical data draws identical geometry', () => {
    for (const s of Object.values(STAGES)) expect(buildTree(s)).toEqual(buildTree(structuredClone(s)))
  })

  it('always draws all seven life areas, dormant until they have growth', () => {
    expect(summary(buildTree(STAGES.seed))).toMatchObject({ branches: 7, dormant: 7, twigs: 0, leaves: 0 })
    expect(summary(buildTree(STAGES.sapling))).toMatchObject({ branches: 7, dormant: 4, twigs: 3 })
    expect(summary(buildTree(STAGES.mature)).dormant).toBe(0)
  })

  it('grows taller, fuller and leafier at every stage', () => {
    const stages = ['seed', 'sprout', 'sapling', 'mature', 'ancient'].map((k) => summary(buildTree(STAGES[k])))
    for (let i = 1; i < stages.length; i++) {
      expect(stages[i].trunkHeight).toBeGreaterThanOrEqual(stages[i - 1].trunkHeight)
      expect(stages[i].leaves).toBeGreaterThan(stages[i - 1].leaves)
    }
    expect(stages[0].trunkHeight).toBeLessThan(stages[4].trunkHeight)
  })

  it('flowers exactly at level milestones (5, 10, ...)', () => {
    const xpForLevel = (target) => {
      let xp = 0
      while (levelFromXp(xp).level < target) xp += 1
      return xp
    }
    for (const [level, expected] of [[4, 0], [5, 1], [6, 0], [10, 1]]) {
      const t = buildTree(state({ health: { s: skill('s', xpForLevel(level)) } }))
      expect(t.leaves.filter((l) => l.bloom).length > 0).toBe(expected === 1)
    }
  })

  it('a fully grown tree never leaves the frame', () => {
    const t = buildTree(STAGES.ancient)
    const points = [
      ...t.branches.flatMap((b) => [[b.x1, b.y1], [b.x2, b.y2]]),
      ...t.twigs.flatMap((w) => [[w.x1, w.y1], [w.x2, w.y2]]),
      ...t.leaves.map((l) => [l.x, l.y]),
    ]
    for (const [x, y] of points) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(t.width)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(t.height)
    }
  })

  it('uses each area\'s own color, so branches are recognizable', () => {
    const t = buildTree(STAGES.mature)
    for (const b of t.branches) expect(b.color).toBe(b.domain.color)
  })

  it('a paused area keeps its shape (pausing only dims it)', () => {
    expect(buildTree({ ...STAGES.mature, paused: ['health'] })).toEqual(buildTree(STAGES.mature))
  })
})

// A recorded picture of the tree at each growth stage. If the drawing changes on
// purpose, review the difference and update the snapshot; if it changes by
// accident, this is what catches it. `fingerprint` covers every drawn coordinate.
const fingerprint = (t) => {
  const text = JSON.stringify(t)
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0
  return h.toString(16)
}

describe('the recorded picture at each stage', () => {
  it('matches what was reviewed', () => {
    const picture = Object.fromEntries(Object.entries(STAGES).map(([name, s]) => [name, { ...summary(buildTree(s)), fingerprint: fingerprint(buildTree(s)) }]))
    expect(picture).toMatchSnapshot()
  })
})
