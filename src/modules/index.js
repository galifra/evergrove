import { createRegistry } from '../core/registry'
import { evergroveModule } from './evergrove'
import { tasksModule } from './tasks'
import { calendarModule } from './calendar'
import { moneyModule } from './money'
import { goalsModule } from './goals'
import { peopleModule } from './people'
import { vaultModule } from './vault'
import { deriveEvergrove } from '../evergrove/derive'

export const BESPOKE_MODULES = [tasksModule, calendarModule, moneyModule, goalsModule, peopleModule, vaultModule]

export function createAppRegistry(log) {
  const registry = createRegistry({ log })
  registry.register(evergroveModule)
  for (const m of BESPOKE_MODULES) registry.register(m)
  return registry
}

// Everything that appears in the Apps grid: full modules plus every tracker
// (built-in and any created by talking).
export function listApps(events) {
  const trackers = deriveEvergrove(events).trackers
  return [
    ...BESPOKE_MODULES.map((m) => ({
      id: m.id,
      name: m.name,
      icon: m.icon,
      description: m.description,
      area: m.area,
      kind: 'module',
      sensitive: !!m.sensitive,
    })),
    ...trackers.map((t) => ({
      id: t.id,
      name: t.name,
      icon: t.icon,
      description: t.description,
      area: t.area,
      kind: 'tracker',
      sensitive: !!t.sensitive,
    })),
  ]
}

// Startup jobs that append deterministic-id events (safe to re-run anywhere).
export async function runMaintenance(log, now = new Date()) {
  const jobs = BESPOKE_MODULES.filter((m) => m.maintenance)
  let added = 0
  for (const m of jobs) {
    const events = m.maintenance(log.getEvents(), now)
    if (events.length) added += (await log.append(events)).length
  }
  return added
}
