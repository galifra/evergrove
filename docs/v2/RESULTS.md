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

## Phase 7: honest feedback, and speaking up when necessary

- **The engine** (`packages/rules/src/observations.js`): sixteen observations, each a pure function of your own data with an id, a priority, a private-or-not class, a cooldown and three wordings. Time-sensitive: an overdue bill, a bill due within 3 days, a deadline (tax, insurance) within 3 days, a clash between two timed events in the next 7 days, a task more than 3 days late, 10 or more reviews due. Patterns: a streak of 5+ at risk after 6pm, a goal with no progress for 10 days, a budget over for a second month running, an area silent for 14 days, a habit down under 30% of its usual rate, one area taking 70%+ of a month while two sit still. Wins: a level that is a multiple of five, a 7/14/30/60/100-day streak, a goal or milestone finished, the first growth in an area. Nothing calls the AI.
- **Each threshold is tested on both sides** (fires at the line, not one step before): 38 tests, and a mutation check confirmed the tests fail if a threshold is nudged (3 of 3 changes caught).
- **Limits, all tested**: "only when necessary" shows priority 1-4, at most 2 a day; "more often" priority 1-6, 4 a day; "never" shows nothing anywhere (home, briefing, Sunday line). Between 10pm and 7am only the most urgent may appear. A note already shown today stays on screen and counts against the day. A cooldown holds for its whole length and ends on the day (checked at 1, 9 and 10 days for a 10-day cooldown). Wins are said once. A 45-day simulation with a busy life, opened three times a day, never exceeded the daily limit under either setting. Paused areas stay silent for habits, goals, silent-area and win notes and come back when the area does.
- **Muting**: "not useful" quiets that kind for 30 days (checked at day 29 and day 30), a thumbs-down alone does not, and a list in Jarvis settings unmutes early. Ratings are `feedback.given` events and shown notes are `note.shown` events, so all of it syncs.
- **Wordings**: three per observation, rotated by how often that kind was shown on earlier days so a note never reads the same twice in a row (tested over a week); none blank, none with an exclamation mark, emoji or scolding; none equal to a Today line.
- **Privacy**: money observations (and a private tracker's level-up) are marked private. In a notification they read only "Something in Money needs your attention." The weekly review shows a private skill as its area even on screen, and everything sent to the AI (weekly polish, opinions) is built without private names, amounts or notes unless you shared that app.
- **Goal coach**: a stalled goal's note has a "Split it into steps" button that proposes up to three tasks from its unfinished milestones (or three generic first steps), and one click adds them as ordinary `add_task` actions linked to the goal. Checked live in the browser: 2 tasks proposed and added; tested that one undo each removes them.
- **Weekly review** (`/jarvis/weekly`, and by typing "weekly review"): the week ending on the latest Sunday, built on the device: what grew (with a total), what stalled, wins (first-growth wins folded into one line), one suggestion, one question from a fixed list that rotates by week. Built twice from the same data it is word for word the same (tested). On Sundays the evening briefing adds "Your weekly review is ready in Jarvis." and, on any evening, one "Jarvis's note:" line, which is generic for anything private and absent when he is set to never speak up.
- **Optional AI, on request only**: "Put it in my words" on the weekly screen (one call a week at most, kept in the log so it is not repeated) and "what do you think ..." in the chat. Both run without tools with their own instructions, are refused by the server at 80% of the monthly cap with "I'm on a short ration this month..." (tested at just under, at, and over 80%, and at 100%), and count their spend under their own name for the cost review in Phase 8.
- **Real replies, read**: `npm run feedback` (about 6 cents) writes `docs/v2/FEEDBACK-SAMPLE.md`. The first run found real problems that are now fixed in his instructions: on an empty account he called the week "steady"; he said "you said matters" about something nobody said; he guessed at feelings ("you might be feeling stuck"); on money that was not shared he gave a small speech about money in general; he ran past the length limit. The last run passes the automatic checks (tone, length, no invented figures, nothing he must never say). Whether the wording feels honest and kind is yours to judge in that file; a few lines are still a little wordy or interpretive.
- **Ratings of replies** carry the words you said and his reply so they can become test cases, except for a reply that touched a private app or was built from private data (weekly review, briefing), which keep only the action names. "Export my feedback" (button in settings, or type it) writes those as a file with ready-to-paste routing-case snippets.
- **Honest deviations and limits**:
  - The backlog says a budget over "for the second week"; the spec says the second month, and the second month is what is built (budgets are monthly).
  - The backlog says "show one note on the Jarvis home"; the home shows up to the day's allowance (2 by default), the first of them directly under the greeting.
  - Two devices opened at the same moment could each show a new note before their logs meet, so the daily limit is enforced per device at the moment of showing and by the shared log afterwards.
  - The evening notification is built by the service worker from the device's data; its note ignores cooldowns (an overdue bill still earns its line each evening) but respects muting, "never", quiet hours and privacy.
  - Not exercised in a real phone or a real push notification.

## Phase 8: cost control ($2 a month stays)

- **Measured on the real model** (`npm run measure`, about 6 cents, results in `docs/v2/COST-MEASURED.md`): on a well-filled account a chat turn is a prompt of about 9,400 tokens, of which about 8,600 come from the cache. Before any change a warm chat turn cost **$0.0051** (the plan assumed $0.004), the optional weekly write-up **$0.0012** and an opinion **$0.0017**.
- **Caching was only half working, and is now fixed.** The tool list was cached but the 1,700 tokens of fixed instructions after it were paid for in full every turn. The fixed instructions and the once-a-day material (date list, worked-out phrases, tracker catalog) now sit in the cache too, with only who you are, the time and your data outside it. A warm chat turn now costs **$0.0021**, about 59% less, and the cache was read on 10 of 10 turns.
- **The catch, stated plainly**: the cache lasts five minutes. The first turn of a burst of chatting writes it and costs about **$0.012** (measured token counts, priced by the server's own price table), so how the chat is spread through the day matters more than how much of it there is.
- **A heavy month** (15 chats a day, four weekly write-ups, eight opinions), from those recorded numbers: one burst a day about $1.28, two bursts $1.58, three $1.87, four $2.17, five $2.46. Tests run the month day by day through the server's own functions: two or three bursts a day stay under the cap; five scattered bursts a day would reach it near the end, and then the rules below protect the chat.
- **Tool list not trimmed.** Cut by a tenth it would save about a hundredth of a cent per warm turn, and any change to it needs the full routing eval again. Not worth the risk.
- **Ration rules, in the server and tested** (`server/usage.js`, `api/jarvis.js`): optional AI (the weekly write-up, opinions) is refused at 80% of the cap (checked at $1.59 open, $1.60 closed); the weekly write-up alone may not take more than a tenth of the cap ($0.20); at 100% everything from the server stops. Local commands, reply templates and every app keep working with the allowance spent (a test lists each quick command and confirms none needs the server, and that the only typed command needing the AI is asking for an opinion). The cap is one number for the whole address: Jarvis and the tree's typed entries write to the same counter (tested).
- **Plain words instead of failing quietly**: the server's refusals now read "I'm on a short ration this month..." and "I've used this month's AI allowance, so I can only do the quick commands until it resets on the 1st...". In the chat they appear as his own message, not a red error; once a month, when the line is crossed, he says so unprompted; the weekly screen's button is disabled with the reason. The client's text and the server's are held equal by a test.
- **Cost review with a split by feature** in Jarvis settings and in Evergrove's settings (one shared panel): this month's spend against the cap with the 80% line marked, what it went on (chat, typed entries on the tree, weekly write-up, opinions), and earlier months. Checked in the browser with made-up figures.
- **Still open**: the full routing eval has not been re-run since the prompt was restructured for caching. It was not run this time (about half a dollar of your API key); it is due once at the end (Phase 9/10), and a score under 95% would need the change reverted or fixed.

## Phase 9: cutover preparation (nothing deployed)

You asked for version 2 to be built and tested before it goes anywhere, so this phase stops at the door: everything that can be prepared and checked without publishing is done, and the rest is left unchecked on purpose.

- **Rollback re-checked**: tag `v1-final` is `f679c7e`, equal to `master`; it is now also in the JARVIS repository. The version 1 production deployment `evergrove-3pifn1hdv-focus23.vercel.app` is listed as Ready. The rollback command is in `docs/v2/CUTOVER.md`.
- **Data format**: unchanged. Version 2 adds event types and one optional field, which version 1 ignores (tested for the field; version 1's tree code skips unknown types).
- **One-command health check** (`npm run health`): tests, lint, generated files current, build, dependency audit, in one go; with `--url <address>` it also makes a real request to every path (31 pages and manifests), the no-slash addresses, Jarvis's deep addresses, `/sw.js`, the security headers and the "no code, no entry" answer of each API. Run against a local preview: 54 of 54 checks pass (headers and API skipped, they belong to the host). Its header and API checks were proven on your live version 1 site (read-only): all four APIs answered 401 without a code, the service worker is served fresh, the strict script policy is present; only the "which app is this page" check fails there, as expected, because version 1 has no per-app pages.
- **Local numbers today**: 558 tests pass (4 skipped are the real-model runs), lint has no errors, the build succeeds, `npm audit` finds 0 vulnerabilities.
- **Not done, and why**:
  - The backup export (only your browser can do it).
  - Deploying a preview address, importing your backup there, the smoke pass on it, the rollback rehearsal, and everything after (production, service-worker update, the 9 PM briefing, the 7-day watch). Each publishes version 2 somewhere, so each waits for your yes.
  - The routing eval on the final build (about half a dollar of your API use; the prompt was restructured for caching since it last ran).
- The acceptance walkthrough was rewritten for everything built since it was first drafted (17 steps).
