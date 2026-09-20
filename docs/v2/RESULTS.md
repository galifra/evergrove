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

## Phase 3: the log viewer (`/log`)

- 22 tests on the viewer's logic: summaries, filters (app, type, area, who wrote it, date range inclusive at both ends), search, newest-first ordering, correction chains, growth explanations, stats, exports.
- Private contents: money, health, mind, people, Compass and vault entries show only "<App> entry (private)" and cannot be found by searching their contents until "Show private contents" is on. Checked both in tests and in the browser (14 private rows masked; searching a private word found nothing until revealed, then found it). The setting is never remembered.
- Corrections are shown, not hidden: an undone entry is struck through and marked "undone", its reversal is marked "undo", and "Undo this undo" restores the original. The reverse action asks first, adds a correcting entry and deletes nothing (checked live: 49 to 50 entries, 1 correction).
- New events carry a short device id (checked live: "device 2f500ba1"); older ones read "earlier". It is an extra field that an older copy of the app ignores, and there is a test for that.
- Exports: JSON and CSV of exactly what is filtered; private contents are replaced unless shown; a cell that starts with `=`, `+`, `-` or `@` is neutralised so a spreadsheet cannot run it.
- Scale: 20,000 events are filtered, searched and summarised in a test well inside its 5-second budget; the screen only draws 100 rows at a time.
- Not exercised in the browser: the file downloads themselves (the content is tested).
