# Version 2 build results (measured, not estimated)

A running log of what was measured while building, so the checked boxes in `docs/BACKLOG-V2.md` have evidence behind them.

## Phase 1: shared packages

- All 320 version 1 tests passed unchanged after the move.
- The main script was byte-for-byte the same size as the live version 1 (579,849 bytes, 180 kB gzip).
- The stylesheet was about 1.7 kB smaller. A class-by-class comparison showed the only differences were words in the docs that Tailwind had wrongly turned into classes in version 1 (`transform`, `blur`, `ease-in` and similar). None are used by any screen.

## Phase 2: one page per app

- Build: 23 pages (one per app, one for custom trackers, one 404), each 1.6 kB, all sharing chunks. The shared frame is 369 kB (117 kB gzip); every screen is its own 2 to 25 kB file loaded only where used.
- Precache: the worker keeps 182 files ready (23 pages, 21 scripts and styles, 22 manifests, 110 icons).
- All 26 paths checked by loading them: every app, the trailing-slash and no-slash forms, a Jarvis screen, a custom tracker, and two unknown paths (which show "Nothing here").
- Live cross-app update: a task added at `/tasks` appeared in the Today card at `/` without a reload.
- Old links: `/#/jarvis/brief` (what an old notification opens) landed on Jarvis and posted the briefing.
- **Offline, with the server stopped:** `/money/`, `/goals`, `/health/`, `/vault/`, `/creativity/`, `/jarvis/memory`, `/t/<any>` and an unknown path all opened with their full content.
- Speed: with files coming from the worker's cache, an app page finishes loading in about 110 ms (first byte 8 ms, all files by 110 ms).

### Bugs the checks caught

- The dev and preview server crashed at start because a plugin hook returned a value Vite treats as a callback. Fixed.
- Vite renamed the manifests with hashed names when they sat next to the pages. They now live in `public/` so their addresses never change.
- **Files kept ahead of time were not found later** because the server sends `Vary: Origin` and a synthetic install-time request does not carry an `Origin` header. Pages loaded but their scripts failed offline. The worker now looks files up by address alone (`ignoreVary`), with a test.
- The Jarvis page title read "Jarvis · Jarvis". Fixed.

### Not verified here

- The browser's own "Install app" prompt (needs a real window). The manifests pass a strict validity test (names, scope, ids, icon sizes, files exist), and every app is on your acceptance walkthrough (step 3).
- A Vercel preview address (this repository is not connected to Vercel; see `docs/v2/CUTOVER.md`).
