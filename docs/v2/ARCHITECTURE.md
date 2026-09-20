# Version 2 architecture (P0.1, P0.4, P0.5)

Decisions D1 to D7 are recorded in `docs/BACKLOG-V2.md`. This file is the design the code follows.

## One address, many apps

Everything is served from `https://evergrove-neon.vercel.app`. One address means one browser database, one service worker, one notification permission and one access code, so every app is instantly in step with every other. Apps are separate in code, screens, icon and installable window, not in hosting. The address must never change.

## Route table (P0.4)

Every app is one row. The generator (`scripts/gen-entries.mjs`) turns this table into an HTML page and a manifest per app, and a test fails if the table and the app registry disagree.

| Path | Name | Kind | Colour | Notes |
| --- | --- | --- | --- | --- |
| `/` | Evergrove | hub | #34d399 | Tree, Today card, app directory link |
| `/apps` | Apps | hub | #34d399 | Directory of every app, app ideas ready to build |
| `/log` | Log | hub | #94a3b8 | Read-only view of the shared log |
| `/tasks` | Tasks & habits | module | #f59e0b | |
| `/calendar` | Calendar | module | #60a5fa | |
| `/money` | Money | module | #22c55e | private |
| `/goals` | Goals | module | #a78bfa | |
| `/people` | People | module | #f472b6 | private |
| `/vault` | Vault | module | #94a3b8 | private, encrypted |
| `/body` `/health` `/mind` `/selfcare` `/learning` `/creativity` `/career` `/hustles` `/travel` `/home` `/records` `/compass` | trackers | tracker | per area | health, mind, compass private |
| `/t/<id>` | custom tracker | tracker | per area | made by talking; one rewrite serves all |
| `/jarvis` | Jarvis | assistant | #38bdf8 | `/jarvis/memory`, `/jarvis/brief`, `/jarvis/weekly` are screens inside it |

Every app entry gets: title, theme colour, its own `manifest.json` (`id`, `scope`, `start_url`, standalone), icons, and the same shell.

Old links keep working forever: `/#/app/<id>` to `/<id>`, `/#/timeline` to `/log`, `/#/apps` to `/apps`, `/#/jarvis` to `/jarvis`, `/#/jarvis/brief` to `/jarvis/brief`. A notification from a device still running the old version opens the old link and is redirected.

## Code layout and the boundary rule (P0.5)

```
packages/core     event log, store, registry, schema, crypto, sync, storage, domains, tree maths
packages/modules  each app's own logic: tasks, calendar, money, goals, people, vault, memory, csv
packages/rules    growth rules, insights, observations, today, briefing, tracker views,
                  the app registry, Evergrove's own actions, integrity check
packages/ui       shared building blocks and the tree drawing
packages/kit      the runtime every app runs on: store, sync, settings, router, push, speech,
                  service worker, settings screen, onboarding
apps/evergrove    the mother app's screens and entry
apps/jarvis       the assistant's screens, prompts, routing
```

Allowed dependencies point only down this list: `core` < `modules` < `rules` < `ui` < `kit` < `apps/*`. Nothing imports upward or sideways, and `apps/evergrove` never imports `apps/jarvis` or the reverse. A test (`tests/boundaries.test.js`) reads every import and fails on a violation. Tests themselves are exempt because integration tests must cross layers.

Why this order: `rules` needs the apps' logic (Today and the briefing read every app), and `modules` must never need `rules`. The old code had one loop (Evergrove's own actions and the app registry needed the rules, which needed the apps); moving those two files into `rules` removes it.

## How apps talk

Only through the log. Jarvis writes an event, and every app on the address sees it at once through the browser's broadcast channel and the shared database. Between devices the encrypted relay carries the same events (seconds, on open, on focus, after a write). Apps never call each other.

## Compatibility

Stored data does not change shape in version 2. New event types (`memory.*`, `feedback.given`, `note.shown`) are ignored by version 1 code, so a rollback to `v1-final` loses nothing and breaks nothing. New fields on old events are optional.

## Build

One Vite build with many entry pages sharing chunks. Each page is tiny (title, manifest link, colour, `data-app`); one shell script reads `data-app` and loads only that app's screen. The service worker precaches every page and asset so any app opens offline.
