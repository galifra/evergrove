import { createRegistry } from '@evergrove/core/registry.js'
import { evergroveModule } from './evergroveModule'
import { tasksModule } from '@evergrove/modules/tasks.js'
import { calendarModule } from '@evergrove/modules/calendar.js'
import { moneyModule } from '@evergrove/modules/money.js'
import { goalsModule } from '@evergrove/modules/goals.js'
import { peopleModule } from '@evergrove/modules/people.js'
import { vaultModule } from '@evergrove/modules/vault.js'
import { memoryModule } from '@evergrove/modules/memory.js'
import { deriveEvergrove } from './derive'

export const BESPOKE_MODULES = [tasksModule, calendarModule, moneyModule, goalsModule, peopleModule, vaultModule]

// Memory is Jarvis's own data, not an app you open, so it has no page and is not listed in the Apps grid.
export const INTERNAL_MODULES = [memoryModule]

export function createAppRegistry(log) {
  const registry = createRegistry({ log })
  registry.register(evergroveModule)
  for (const m of [...BESPOKE_MODULES, ...INTERNAL_MODULES]) registry.register(m)
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
