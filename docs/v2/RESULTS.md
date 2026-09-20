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

## Phase 4: Jarvis as his own app

- Jarvis has his own page-load and script (`apps/jarvis`), his own icon (sky blue "J"), manifest (`scope /jarvis/`) and title. The mother app no longer contains any Jarvis code (the import-boundary test has no exceptions left).
- The home now opens with a greeting for the time of day and the Today list (shared with the tree, including dismissals), then the chat. Every answer that touched an app has an "Open <app>" link. The AI spend meter stays in his header.
- Live link with the apps, tested with two windows on one log (the same mechanism two tabs use): a task added through Jarvis is on the Tasks app and the Today list within a moment; a workout logged in the Body app changes what Jarvis knows on his next answer; an undo in one is an undo in the other; a change made while the other window was closed is there when it opens.
- Checked live: `/jarvis/` shows the greeting and the real Today list.
- Still open: the browser's install prompt for Jarvis (needs a real window), and the routing eval score from the new location (run once at the end, after the last prompt change).

## Phase 5: the butler's voice

- The instructions are now four layers in `server/prompt.js` (identity, voice, boundaries, tool rules), tested for order and content. What the person chooses (a name, butler style, a form of address) is added as a separate, cleaned block: only letters, numbers, spaces, dots, apostrophes and hyphens survive, at most 40 characters, so a name cannot smuggle in instructions.
- Routine replies (done, waiting for approval, error, "I didn't follow") come from templates and cost nothing; they are never blank and never shout. All fixed lines pass a mechanical tone check (no emoji, no shouting, short, no scolding, nothing that reads as diagnosing or investment advice).
- Spoken replies use the browser's own voice (voice, speed and a sample in Jarvis settings, a Stop button while speaking). Private details are not read aloud unless that app is shared: a reply that touched Money is spoken as "Done. The details are in Money." (tested).
- **Reading real replies found real mistakes**, all now fixed in his instructions and covered by routing cases:
  - "I skipped stretching again" made him check the habit off as done.
  - "I reached level 10" made him log 40 xp that never happened.
  - He blamed a monthly total on one category (the money summary now says "across all categories").
  - He said he would remember, and had forgotten, things with no memory tool to do it.
  - Several answers ran long; the limits are stated, and the automatic check flags anything over about 420 characters.
- `npm run tone` runs 25 situations through the real model and writes `docs/v2/TONE-SAMPLE.md` for you to read (about 10 cents). The last run passed every automatic check. Whether the replies feel warm is yours to judge.
- Still open: the greeting's "one note when something is necessary" (Phase 7), and your reading of the sample.

## Phase 6: memory

- Jarvis keeps short notes about you (`memory.noted`, `memory.revised`, `memory.forgotten` events): preference, routine, goal, person or fact, with a private flag. Nothing is saved silently: you type "remember that ..." (your own command), or he offers a note and it waits for your click, like any other action. Forgetting asks first, is undoable, and deletes nothing from the log.
- Limits, all tested: 200 notes, 20 new a day, 240 characters, no duplicates.
- What he is told is chosen on the device by a fixed rule, with no AI call: private notes are left out unless you share "Memory"; preferences, routines and goals come first; words shared with your message and recent notes rank higher; at most 12 notes and about 1,600 characters. The notes travel as a marked block of data, cleaned and capped on the server, and a hostile note triggers no action and can't approve itself (tests).
- Forgetting really forgets: a forgotten note is absent from every later request, and the removal reaches another window on the same log (tests).
- `/jarvis/memory`: list, edit, change kind, mark private, forget (with confirmation), filter, and the count against 200. Private notes are masked (text and kind) until you tick "Show private notes", which is never remembered. Checked in the browser at phone width: no sideways scroll.
- Your name: asked once on Jarvis's home ("Not now" ends it), saved as a note, used in the greeting ("Good afternoon, Gabe.") and sent to the assistant as the cleaned name field; changeable in Jarvis settings or from the notes list. Checked live.
- Chat: "remember that ...", "call me ...", "what do you remember", "forget that" (the note saved a moment ago) and "forget <words>" (one match asks first; several asks which). Checked live: remember, forget that, Do it, and the confirmation.
- The "What the AI saw" panel lists the notes that were included, with a Correct-it link, and the copyable request now includes the name and notes.
- Real-model routing (a real call, about 2 cents each run): "remember to call mom on Sunday" first became a memory note, a real mistake, and is now taught to be a task; a lasting fact ("I am vegetarian") was offered as a note 3 of 3 times; a preference, a skipped gym day and a passing dream were never saved as notes. Five memory cases are in the routing set (140 phrases). The full 95% score is still to be re-run once at the end.
