# Evergrove + Jarvis, version 2 backlog

Legend: `[ ]` not done, `[x]` done and verified. `D` = a decision (all decided below). `T` = a test. `[you]` = something only you can do. Order is chronological; a phase is done only when its tests pass. The version 1 backlog (`docs/BACKLOG.md`) is left exactly as it was.

## What version 2 is

Evergrove becomes the **mother app**. Every smaller app gets its own address under it (`/money`, `/tasks`, `/calendar` and so on) and can be installed on a phone as its own icon. Jarvis becomes its own **installable app at `/jarvis`**: a butler and friend who commands the other apps, remembers what you tell him, and gives you honest feedback. All of it lives at one web address, so all of it shares one database and is instantly in step. The shared log becomes viewable in Evergrove.

```
  evergrove-neon.vercel.app          (one address = one database = instantly in step)
  ├── /            Evergrove: the tree, app directory
  ├── /log         the shared log, viewable
  ├── /tasks /calendar /money /goals /people /vault
  ├── /body /health /mind /selfcare /learning /creativity /career /hustles /travel /home /records /compass
  ├── /t/<name>    trackers you make by talking
  └── /jarvis      Jarvis (chat, voice, memory, feedback), its own installable app

  All built from ONE shared code library: log, apps' actions, growth rules, sync, privacy rules.
  Phone <-> computer stays in step through the encrypted relay (a few seconds, no background polling).
```

## Decisions recorded (all decided)

- **D1** Free address only. Keep `https://evergrove-neon.vercel.app`. **The address must never change**: a new address is a new empty database and would strand your data and notification permission. A custom domain can be added later as an extra name, only after a data move plan.
- **D2** One address for everything, separate apps by path (not separate sites). Jarvis is separate in code, screens, icon and window, not in hosting.
- **D3** Evergrove is the mother of the smaller apps; the smaller apps live under it by path.
- **D4** The AI cap **stays at $2 a month**. Friend-mode has to fit inside it (see Phase 8).
- **D5** Jarvis speaks up unprompted **only when necessary** (defined in P0.8), and you can change that to "more often" or "never".
- **D6** Encryption at rest stays parked until after version 2.
- **D7** Phone testing waits; everything must still be proven without a phone where possible.

## Ground rules (added to the version 1 rules)

- Apps never import each other. They share only the library and the log. A test enforces this.
- Nothing stored or synced changes shape without a compatibility test: an old copy of the app must ignore any new event type instead of breaking.
- No background polling. Sync stays event-driven (open, focus, after a write).
- Rules before AI. Anything Jarvis can say from a rule or a template costs nothing, and does not call the model.
- Jarvis never saves a memory silently, never gives medical or personal financial advice, never guilt-trips, and goes quiet in paused areas.
- Every step below ships tested, is deployed only after tests, lint and build pass, and is checked on the live site.
- Before any step that could touch stored data, there is a fresh backup export.

## Route map (P0.4 turns this into the final table)

| Path | App | Notes |
| --- | --- | --- |
| `/` | Evergrove | Tree, Today card, app directory link |
| `/apps` | App directory | All apps, app ideas ready to build |
| `/log` | Log viewer | Read-only view of the shared log |
| `/tasks` `/calendar` `/money` `/goals` `/people` `/vault` | Module apps | Each installable, each with its own icon and colour |
| `/body` `/health` `/mind` `/selfcare` `/learning` `/creativity` `/career` `/hustles` `/travel` `/home` `/records` `/compass` | Tracker apps | One shared page, one entry per tracker |
| `/t/<id>` | Custom trackers | Made by talking to Jarvis |
| `/jarvis` | Jarvis | Chat, voice, briefing, memory, feedback |
| `/jarvis/memory` `/jarvis/brief` `/jarvis/weekly` | Jarvis screens | |

---

## Phase 0 - Specs and safety net (no app code)

- [x] P0.1 Write the version 2 section of `docs/SPEC.md` recording decisions D1 to D7.
- [x] P0.2 Tag the current commit `v1-final` and note the current Vercel production deployment id, so a one-command rollback exists.
- [ ] P0.3 [you] Export a backup of your real data (Settings, Export) and keep the file somewhere private, outside the project.
- [x] P0.4 Write the route table: path, app name, module id, icon, colour, PWA scope, page title.
- [x] P0.5 Write the library boundary spec: `core` <- `apps (modules)` <- `rules` <- `ui` <- `screens`; nothing imports upward or sideways.
- [x] P0.6 Write the Jarvis personality guide: voice (warm, dry, direct, short), how he addresses you, honesty rules (tells you the truth kindly, no flattery), boundaries (no medical or personal financial advice, no guilt, no nagging, respects paused areas), and 12 example replies for real situations (win, slip, overspend, conflict, quiet week, bad mood, asked for opinion, asked to do something risky, a lapse he should let go, a milestone, unclear request, error).
- [x] P0.7 Write the memory spec: event types, fields, limits (200 notes, 240 characters each), categories, consent rule (only saved when you say "remember" or say yes when he offers), privacy classes, how it is shown to the AI.
- [x] P0.8 Write the feedback spec: the observation catalog (see Phase 7), each with trigger, threshold, priority, cooldown, privacy class, three wordings. Define **"necessary"** exactly: (a) something time-sensitive (bill due or overdue, event clash, deadline within 3 days, review queue overflowing), or (b) a meaningful pattern crossed a threshold (a streak about to break, an area silent for two weeks, a goal stalled for 10 days, a real win). Everything else waits until you ask.
- [x] P0.9 Write the cost plan: token budget per feature, the 80% rung, the monthly simulation parameters (Phase 8).
- [x] P0.10 Write the cutover and rollback plan (Phase 9), including the exact rollback command.
- [x] P0.11 Write your acceptance walkthrough: ten short things you can do in about ten minutes to confirm version 2 works, with what you should see for each.
- [x] TP0 Paper test: walk these through the specs end to end and record the outcome of each: open `/money` directly from a bookmark; log a workout in `/body` while `/jarvis` is open in another window; tell Jarvis to add a task and see it in `/tasks`; a bill goes overdue; Jarvis has two things to say but the limit is one; you mark a suggestion "not useful"; you say "remember I run best in the morning"; you say "forget that"; the AI cap reaches 80%; the cap is reached; the old notification link `/#/jarvis/brief` is tapped; a deploy happens while a tab is open.

## Phase 1 - Shared library, no visible change

- [x] P1.1 Convert the repo to an npm workspace (root config, `packages/`, `apps/`), keeping `api/` and `server/` where Vercel expects them.
- [x] P1.2 Move `src/core` to `packages/core` (events, store, log, registry, schema, match, crypto, sync, verify) with its tests.
- [x] P1.3 Move `src/modules` to `packages/apps` (one folder per app: its derive, its actions, its context) with tests.
- [x] P1.4 Move `src/evergrove` (rules, derive, insights, trackers, trackerViews, today, briefing, appSpec, migrate) to `packages/rules` with tests.
- [x] P1.5 Move shared screens' building blocks (`ui.jsx`, `useAction`, `useDialog`, icons, access-code prompt) to `packages/ui`.
- [x] P1.6 Move the app runtime (provider that opens the store, sync, settings, service-worker registration) to `packages/app-kit`.
- [x] P1.7 Move the current pages and entry to `apps/evergrove`, still one single-page app for now.
- [x] P1.8 Fix every import; make Vitest and lint run across all packages; keep one command (`npm test`) for everything.
- [x] P1.9 Add the import-boundary test: fail if any package imports upward or sideways, or if one app imports another.
- [x] P1.10 Move the service worker to the shared kit unchanged, and keep its tests.
- [ ] TP1 All 320 existing tests pass unchanged. The built site passes the same 18-app smoke pass as today. Deploy to a Vercel **preview** address and repeat the smoke pass there. Compare the bundle size before and after.

## Phase 2 - Real paths and one entry per app (Evergrove as the mother)

- [x] P2.1 Switch the build to multiple entry pages sharing common chunks.
- [x] P2.2 Write the entry generator: from the app registry it creates one HTML entry per app with the right title, manifest link, theme colour and app id.
- [x] P2.3 Build the shared shell v2: Evergrove home link, an app switcher listing every app and Jarvis, the current app's name, and Settings.
- [x] P2.4 Replace hash routing with real paths. Keep a permanent redirect from every old link: `/#/app/<id>` to `/<id>`, `/#/timeline` to `/log`, `/#/jarvis` to `/jarvis`, `/#/jarvis/brief` to `/jarvis/brief`.
- [x] P2.5 Give Tasks and Habits its own entry at `/tasks`.
- [x] P2.6 Give Calendar its own entry at `/calendar`.
- [x] P2.7 Give Money its own entry at `/money`.
- [x] P2.8 Give Goals its own entry at `/goals`.
- [x] P2.9 Give People its own entry at `/people`.
- [x] P2.10 Give the Vault its own entry at `/vault`.
- [x] P2.11 Generate the 12 tracker entries: `/body`, `/health`, `/mind`, `/selfcare`, `/learning`, `/creativity`, `/career`, `/hustles`, `/travel`, `/home`, `/records`, `/compass`.
- [x] P2.12 Serve trackers made by talking at `/t/<id>` through one rewrite rule.
- [x] P2.13 Build the app directory at `/apps` (all apps, app ideas ready to build).
- [x] P2.14 Give every app its own manifest (name, short name, `id`, `scope`, `start_url`, standalone display), colour and icons (192 and 512 PNG plus SVG), so each installs separately.
- [x] P2.15 Update `vercel.json`: rewrites, manifest cache headers, a friendly 404 page; keep the strict security headers and confirm no inline scripts are needed.
- [x] P2.16 Update the service worker: new paths in its page cache, notification click opens `/jarvis/brief`, new build stamp, old caches deleted on activate.
- [x] P2.17 Update every deep link (Today items, buddy widget, insights, briefing) to real paths.
- [x] P2.18 Set the page title and move keyboard focus to the main heading on each navigation; keep the skip link on every page.
- [x] P2.19 Make cross-app navigation feel instant: precache the shared chunks, and record the time to open `/money` from `/` before and after.
- [ ] TP2 (a) Every registered app has a route, an entry and a manifest (test fails if one is missing). (b) Every path loads directly and survives a refresh. (c) All old links redirect. (d) Three sample paths open offline with the server down. (e) Manifests pass a validity script and each is installable. (f) A write in `/tasks` shows in `/` and `/money` in another tab without a reload. (g) Each entry's size is recorded, and shared code is not duplicated across entries.

## Phase 3 - The shared log, viewable (`/log`)

- [x] P3.1 Build the log page shell inside Evergrove, read-only by default.
- [x] P3.2 Show the events as a fast list (smooth with 10,000 events), newest first, with the time, app, type, area and a one-line summary.
- [x] P3.3 Add filters: app, event type, area, date range, who acted (you, Jarvis, the system).
- [x] P3.4 Add text search across event contents.
- [x] P3.5 Add an event detail drawer showing the full record and how it was folded into the tree ("why did this grow").
- [x] P3.6 Show correction chains: an event with its reversal or replacement linked together.
- [x] P3.7 Stamp new events with a short device id, so the log can show which device wrote each one (older events show "earlier").
- [x] P3.8 Add "Reverse this event", which appends a correcting event after a confirm and never deletes anything.
- [x] P3.9 Hide the contents of private apps (money, health, mind, Compass, vault) behind "Show private", off by default, so it is safe to open near other people.
- [x] P3.10 Add export of the filtered view as JSON or CSV.
- [x] P3.11 Add an integrity strip at the top: event count, date range, "Check my data" result.
- [x] TP3 Filters and search return exactly the right events (fixture with 5,000 events); reversal appends and removes nothing; private contents never render until revealed; exports round-trip; the page stays responsive with 20,000 events.

## Phase 4 - Jarvis as its own app (`/jarvis`)

- [x] P4.1 Create the Jarvis entry with its own shell, icon, colour and manifest (`scope /jarvis/`).
- [x] P4.2 Move the chat page into it, unchanged in behavior, with local commands, undo, and clear.
- [x] P4.3 Move the "what the AI saw" panel with it, including copy and stop-sharing.
- [x] P4.4 Move voice input with it.
- [x] P4.5 Build the Jarvis home: an opening line, then the Today list, then the chat box.
- [x] P4.6 Add "Open in <app>" links on every Jarvis answer that touched an app.
- [x] P4.7 Move the evening briefing screen to `/jarvis/brief` and make the notification click open it.
- [x] P4.8 Remove the Jarvis page from Evergrove and replace it with a link.
- [x] P4.9 Keep the spend meter visible inside Jarvis.
- [x] P4.10 Confirm the two-way live link with a test: a task added through Jarvis appears in `/tasks` at once, and a workout logged in `/body` changes Jarvis's next answer.
- [ ] P4.11 Make Jarvis installable and check the install prompt on the computer.
- [ ] TP4 The routing eval still scores at least 95% from the new location; every action, tier and undo behaves as before; the private-data tests still pass with Jarvis in its own bundle; Jarvis works offline for local commands.

## Phase 5 - The butler's voice

- [x] P5.1 Turn the personality guide into a layered system prompt: identity and tone, honesty rules, boundaries, then the existing tool rules.
- [x] P5.2 Add a name setting: what Jarvis calls you (asked once, saved as a memory, changeable).
- [x] P5.3 Add optional style: plain, or butler ("sir/ma'am" style), your choice, off by default.
- [x] P5.4 Write reply templates for the common answers (done, undone, needs approval, error, clarify), so routine replies cost nothing and sound consistent.
- [x] P5.5 Add spoken replies with the browser's built-in voice: toggle, voice choice, speed, and a stop button.
- [x] P5.6 Add the opening line: greets by time of day and, only if something is necessary, adds one note (Phase 7).
- [x] P5.7 Add a personality check set of 25 phrases with a written rubric (warm, honest, short, no emoji, no advice claims, no guilt), scored by reading, not by machine.
- [ ] TP5 Templates never produce a blank reply; spoken replies never read out private data unless you have shared it; the personality set is reviewed by you once and adjusted.

## Phase 6 - Memory

- [x] P6.1 Add the event types `memory.noted`, `memory.revised` and `memory.forgotten` (forgetting is a reversal, nothing is deleted from the log).
- [x] P6.2 Add the action `remember` (saves after you say "remember", or say yes to his offer).
- [x] P6.3 Add the action `forget` (asks first).
- [x] P6.4 Add categories: preference, routine, goal, person, fact, and a private flag for sensitive notes.
- [x] P6.5 Build `/jarvis/memory`: list, edit, delete, filter, and a count against the 200-note limit.
- [x] P6.6 Choose which memories go to the AI with a local rule (private ones excluded unless shared; recent and keyword-relevant first; at most about 400 tokens), no AI call needed.
- [x] P6.7 Let Jarvis offer to remember: when you state a lasting preference he asks "Want me to remember that?" and saves only on yes.
- [x] P6.8 Treat memory text as data, never as instructions (covered by an injection test).
- [x] P6.9 Show which memories informed an answer in the "what the AI saw" panel.
- [x] TP6 Nothing is ever saved without consent; forgetting removes it from all future requests and syncs to other devices; the limit is enforced; a hostile memory text triggers no action; a private memory never appears in a request unless shared.

## Phase 7 - Honest feedback, and speaking up when necessary

- [x] P7.1 Build the observation engine: each observation is a pure function of your data with an id, priority, cooldown, privacy class and wordings.
- [x] P7.2 Add the time-sensitive observations: bill due soon, bill overdue, deadline within 3 days, event clash, review queue overflowing, a task overdue more than 3 days.
- [x] P7.3 Add the pattern observations: streak about to break, area silent for 14 days, a habit dropping compared with last week, a goal with no progress for 10 days, an area getting far more attention than all others, budget over its limit for the second week.
- [x] P7.4 Add the positive observations: a real win (level up, a first, a long streak, a goal milestone), so feedback is not only about what is wrong.
- [x] P7.5 Add three wordings per observation, so he does not repeat himself, all in the personality guide voice.
- [x] P7.6 Add the goal coach: when a goal stalls, he offers to split it into smaller tasks and does so with one approval (uses existing actions and tiers).
- [x] P7.7 Add the limits: at most 2 unprompted items a day inside the apps and 1 in a notification; a 7-day cooldown per observation; nothing during your quiet hours; nothing for paused areas.
- [x] P7.8 Add the setting "Jarvis speaks up": only when necessary (default), more often, or never.
- [x] P7.9 Add thumbs up and down on every unprompted note and every reply; "not useful" silences that kind for 30 days (stored as `feedback.given` events so it syncs).
- [x] P7.10 Show one note on the Jarvis home and, when there is one, add it to the evening briefing as "Jarvis's note". No new scheduled jobs are needed.
- [x] P7.11 Build the weekly review at `/jarvis/weekly`: what grew, what stalled, wins, one suggestion, one question; built from templates and delivered with Sunday's briefing.
- [x] P7.12 Add an optional single AI call per week to polish the weekly review's wording (off if the cap is past 80%).
- [x] P7.13 Add "what do you think?": on request, he gives an honest opinion about an area, a goal or the week, using your insights and memories (an AI call you asked for).
- [x] P7.14 Add "export my feedback": `feedback.given` events become new routing and personality test cases.
- [x] TP7 A month of synthetic data never exceeds the daily limits; each observation fires exactly when its threshold is crossed and not before; cooldowns and quiet hours hold; paused areas stay silent; "never" really is silent; "not useful" suppresses; private-class observations never go into notification text; wordings are never blank; the weekly review is identical when built twice from the same data.

## Phase 8 - Cost control ($2 a month stays)

- [ ] P8.1 Measure real tokens per request type (chat turn, weekly polish, opinion), including memory and observation context, and record them.
- [ ] P8.2 Verify prompt caching is really hitting (cache-read tokens) after the prompt grows, and trim the tool list where the routing eval allows.
- [ ] P8.3 Set the ration rules: proactive AI use may take at most 10% of the cap; at 80% of the cap Jarvis stops all optional AI (weekly polish, opinions) and says so once; at 100% the existing hard stop applies.
- [ ] P8.4 Make him budget-aware in plain words: "I'm on a short ration this month" instead of failing quietly.
- [ ] P8.5 Show the monthly cost history with a per-feature split.
- [ ] P8.6 Add a simulation test: a heavy month (about 15 chats a day plus weekly extras) stays under $2 using the recorded token costs.
- [ ] TP8 The 80% and 100% behaviors are tested; local commands and templates keep working at 100%; the cap counter is shared by every app on the address.

## Phase 9 - Cutover

- [ ] P9.1 Take a fresh backup export and re-check the `v1-final` tag and rollback command.
- [ ] P9.2 Deploy everything to a Vercel preview address; import your backup there in a throwaway browser and run "Check my data".
- [ ] P9.3 Run the full smoke pass on the preview: every path, every app, Jarvis chat, install checks.
- [ ] P9.4 Run the full test suite, lint, build, audit, and the routing eval; record the numbers.
- [ ] P9.5 Deploy to production.
- [ ] P9.6 Confirm the service worker update: the old cached version is replaced on the next open, old links redirect, and the existing notification permission still works.
- [ ] P9.7 Confirm the live site with the checks from the last health check, plus a real request to every path.
- [ ] P9.8 [you] Open the site once on your computer, then run the acceptance walkthrough (P0.11).
- [ ] P9.9 Watch the 9 PM briefing arrive and open it into `/jarvis/brief`.
- [ ] P9.10 Keep the rollback ready for 7 days; if anything is wrong, roll back first and fix second (data is unaffected because the stored format does not change).
- [ ] TP9 A restore of the backup onto a clean browser matches your data exactly; rollback is rehearsed on the preview; no data is lost across the cutover.

## Phase 10 - Hardening, accessibility, documentation

- [ ] P10.1 Accessibility pass on every new screen: keyboard reachable, visible focus, correct headings, live regions for Jarvis's spoken and written notes, reduced motion respected.
- [ ] P10.2 Security review of the same-address design: one script problem would touch every app, so re-check for injection sinks, keep the strict content policy, keep the access-code gate on every route.
- [ ] P10.3 Add the routing eval cases for version 2: memory ("remember", "forget"), feedback ("what do you think", "not useful"), and "must not speak up" cases.
- [ ] P10.4 Update the README, SPEC and SECURITY documents for version 2.
- [ ] P10.5 Update the health-check routine (a written checklist plus scripts) so it can be rerun in one command.
- [ ] P10.6 Full final run: tests, lint, build, audit, eval, smoke, deploy, live verification.
- [ ] P10.7 Check off this file honestly, leaving anything unverified unchecked.
- [ ] P10.8 Update the project memory notes with the final state.

## Carried over from version 1 (status now)

- [ ] C1 Version 1 item 3.8 (suggestion throttle) is fulfilled by Phase 7; check it off there when Phase 7 passes.
- [ ] C2 Version 1 item 3.10 (voice input) needs you to try it once with a microphone once Jarvis is at `/jarvis`. [you]
- [ ] C3 Version 1 Phase 9 line (installable app, notifications for every app) is fulfilled by Phases 2, 4 and 7; check off after a real phone test. [you]
- [ ] C4 Version 1 item 0.1 (relationships library) still needs your answer. [you]

## Parked (not in version 2)

- Encryption at rest (v1 item 1.8), until after version 2.
- Calendar timezones (v1 item 4.2).
- A custom domain (a data move plan is needed first, see D1).
- A live cross-device connection (it would cost money; sync stays event-driven).
- Extra scheduled jobs for all-day nudges (the free plan allows two; both are in use).

## Cost table (for P0.9 and Phase 8)

| Item | Estimate | Note |
| --- | --- | --- |
| Chat turn | about $0.0034 | measured on 135 phrases; memory adds a little |
| Turns inside the $2 cap | about 550 a month | about 18 a day |
| Weekly review polish | about $0.01 a week | optional, off past 80% |
| Opinions ("what do you think") | about $0.005 each | you asked for it |
| Observations, templates, spoken replies, briefing, log viewer | $0 | no AI |
| Hosting, storage, notifications | $0 | free tiers |

## Rough size

Phase 0 small. Phases 1 and 2 medium (the riskiest, because they touch every file). Phase 3 small. Phase 4 medium. Phases 5, 6, 7 medium each (Phase 7 is the largest). Phase 8 small. Phase 9 small but careful. Phase 10 small.
