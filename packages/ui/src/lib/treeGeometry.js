import { DOMAINS } from '@evergrove/core/lib/domains.js'
import { domainTotalXp, levelFromXp, skillTotalXp, totalTreeXp } from '@evergrove/core/lib/treeEngine.js'

// Deterministic pseudo-random generator seeded from a string, so the tree's
// shape stays stable across re-renders and only changes when XP actually
// changes — never a random reshuffle on refresh.
function hashString(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(seed) {
  let a = seed
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function project(x, y, angleDeg, length) {
  const rad = (angleDeg * Math.PI) / 180
  return {
    x: x + length * Math.sin(rad),
    y: y - length * Math.cos(rad),
  }
}

const VIEW_W = 800
const VIEW_H = 680
const BASE_X = VIEW_W / 2
const BASE_Y = 640

export function buildTree(state) {
  const total = totalTreeXp(state)
  const trunkHeight = 90 + Math.min(190, Math.sqrt(total) * 8)
  const trunkTop = { x: BASE_X, y: BASE_Y - trunkHeight }
  const trunkWidth = 14 + Math.min(14, total / 120)

  const trunk = {
    key: 'trunk',
    x1: BASE_X,
    y1: BASE_Y,
    x2: trunkTop.x,
    y2: trunkTop.y,
    width: trunkWidth,
    color: '#5c4326',
  }

  const activeDomains = DOMAINS
  const spread = 150 // total degrees the canopy fans across
  const start = -spread / 2

  const branches = []
  const twigs = []
  const leaves = []

  activeDomains.forEach((domain, i) => {
    const rng = mulberry32(hashString(domain.id))
    const dxp = domainTotalXp(state, domain.id)
    const hasGrowth = dxp > 0

    const t = activeDomains.length === 1 ? 0.5 : i / (activeDomains.length - 1)
    const baseAngle = start + t * spread + (rng() - 0.5) * 10
    const branchLen = hasGrowth ? 46 + Math.min(150, dxp * 0.85) : 26
    const branchWidth = hasGrowth ? 3.5 + Math.min(8, dxp / 60) : 2.5

    // branch off a point partway up the trunk, higher xp domains anchor a bit higher
    const anchorT = 0.35 + t * 0.5
    const anchorPoint = project(BASE_X, BASE_Y, 0, trunkHeight * anchorT)

    const tip = project(anchorPoint.x, anchorPoint.y, baseAngle, branchLen)

    branches.push({
      key: `branch-${domain.id}`,
      x1: anchorPoint.x,
      y1: anchorPoint.y,
      x2: tip.x,
      y2: tip.y,
      width: branchWidth,
      color: hasGrowth ? domain.color : '#3a4a3d',
      domain,
      dormant: !hasGrowth,
    })

    const skills = Object.values(state.skills[domain.id] || {})
    const skillSpread = 100
    const skillStart = -skillSpread / 2

    skills.forEach((skill, si) => {
      const srng = mulberry32(hashString(domain.id + ':' + skill.id))
      const { level } = levelFromXp(skillTotalXp(skill))
      const st = skills.length === 1 ? 0.5 : si / (skills.length - 1)
      const twigAngle = baseAngle + skillStart + st * skillSpread + (srng() - 0.5) * 14
      const twigLen = 14 + Math.min(70, level * 8)
      const twigWidth = 1.6 + Math.min(3.5, level * 0.4)
      const twigTip = project(tip.x, tip.y, twigAngle, twigLen)

      twigs.push({
        key: `twig-${domain.id}-${skill.id}`,
        x1: tip.x,
        y1: tip.y,
        x2: twigTip.x,
        y2: twigTip.y,
        width: twigWidth,
        color: domain.color,
        skill,
        domain,
        level,
      })

      const leafCount = Math.max(1, Math.min(7, level + 1))
      const isBloom = level > 0 && level % 5 === 0
      for (let li = 0; li < leafCount; li++) {
        const lrng = mulberry32(hashString(domain.id + ':' + skill.id + ':' + li))
        const jitterAngle = (lrng() - 0.5) * 60
        const jitterLen = 6 + lrng() * 12
        const pos = project(twigTip.x, twigTip.y, twigAngle + jitterAngle, jitterLen)
        leaves.push({
          key: `leaf-${domain.id}-${skill.id}-${li}`,
          domainId: domain.id,
          x: pos.x,
          y: pos.y,
          r: isBloom ? 5.5 : 3.5 + lrng() * 1.5,
          color: isBloom ? '#ffffff' : domain.glow,
          fill: isBloom ? '#fde68a' : domain.color,
          bloom: isBloom,
        })
      }
    })
  })

  return { trunk, branches, twigs, leaves, viewBox: `0 0 ${VIEW_W} ${VIEW_H}`, width: VIEW_W, height: VIEW_H }
}
