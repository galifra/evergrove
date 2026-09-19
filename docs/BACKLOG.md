# Jarvis + Evergrove backlog

Legend: `D` = decision you make, `T` = test, everything else = build task. Order is chronological; a phase is done only when its tests pass.
Today: Evergrove v0 exists (skill tree, AI entry parsing, push reminders). Nothing else is built.

## Ground rules (apply to every phase)

- Every app is a module in one repo: its own page, its own data, a manifest (actions it exposes + events it emits). Usable without Jarvis.
- Apps never call each other. Jarvis commands apps; apps write events to the shared log; Evergrove reads the log.
- Events are append-only, versioned, idempotent. Mistakes are fixed with correction events that reference the original.
- Rules before AI: deterministic code handles known cases; the model is only for fuzzy input.
- Confirmation tiers per action: do automatically / ask first / suggest only. Anything touching other people, money movement, or deletion always asks.
- Evergrove never punishes: branches go dormant, never wither. Areas can be paused ("gentle mode").
- Cost target: as close to $0/month as possible for the whole system (hosting, storage, AI). Local-first storage, free tiers only, rules before AI, hard monthly spend cap. The Money app is a personal budget for you, not a system-cost tool.
- Version one is everything in this backlog, built entirely new. Ronin is not used or imported.
- Definition of done for every app: standalone page works, manifest valid, emits valid events, Evergrove rules written, Jarvis routing cases added to the eval set, works offline, export/backup covers its data.

## Phase 0 - Decisions and specs (no app code)

- D0.1 (decided: phone and laptop) Local-first IndexedDB on each device plus encrypted append-only sync through a tiny free-tier cloud relay. The log merges cleanly because it is append-only. Sync stays inside free-tier limits.
- D0.3 (decided) AI budget: hard cap of about $2/month, cheapest model, rules first. Typing first, voice later. No bank linking anywhere.
- D0.2 Confirm one repo, one deployment, apps as routes/modules.
- 0.1 Check whether the relationships library you mentioned already exists somewhere. Everything else is built new.
- 0.2 Write the v1 event schema: id, type, app, area, occurredAt, recordedAt, schemaVersion, correlationId, recordRef, data, supersedes.
- 0.3 Write the module manifest spec: id, area, pages, actions (with input schema and permission tier), events emitted, data scopes.
- 0.4 Write Evergrove growth rules v1: event type to area/skill/XP, streak rules, dormant/gentle-mode rules, rule versioning.
- 0.5 Write permission and privacy spec: tiers, per-area "never send to AI" flags (health, money, legal default ON).
- 0.6 Write cost guardrails: model tiers (cheap router, escalate on ambiguity), monthly cap, usage meter.
- T0 Paper test: walk 15 sample events (workout, purchase, calendar move, deletion/correction, late-arriving event) through the specs end to end.

## Phase 1 - Shared core

- 1.1 Restructure repo: `core/`, `modules/<app>/`, shell with routing and a home dashboard.
- 1.2 Storage layer (IndexedDB): append event, read by cursor, indexes by area/app/time. Enforce append-only.
- 1.3 Event bus: publish/subscribe, per-consumer cursor so consumers resume after being offline.
- 1.4 Module registry: load manifests, list actions, list pages.
- 1.5 Command channel: Jarvis invokes an action, gets result / error / timeout back; every command written to an audit trail.
- 1.6 Backup: export/import the full log, plus a "rebuild all derived state from the log" command.
- 1.7 Sync (per D0.1): encrypted relay, merge by event id, conflict-free.
- 1.8 Real login and encryption at rest (replaces the shared access code) before any health/money data exists.
- 1.9 AI usage meter and monthly spend cap enforced server-side.
- T1.1 Append-only cannot be bypassed. T1.2 Replaying the same events twice gives identical state. T1.3 Late-arriving events sort by occurredAt without rewriting history. T1.4 Rebuild from scratch equals live state. T1.5 Export/import round trip loses nothing. T1.6 Two devices writing offline then syncing merge with no loss or duplicates. T1.7 Command timeout and failure paths. T1.8 Full offline operation. T1.9 Spend cap blocks calls at the limit.

## Phase 2 - Evergrove becomes the hub

- 2.1 One-time migration of existing entries into events; tree must look identical afterward.
- 2.2 Declarative, versioned rules engine (Phase 0.4 rules as data, not scattered code).
- 2.3 Tree renders purely from derived state; "rebuild tree" button.
- 2.4 Add your own skills: create a branch/leaf by hand, set its area, grow it manually or by talking.
- 2.5 Area pause / gentle mode; dormant visuals.
- 2.6 Deterministic insights (neglected areas, streaks, quiet weeks) stored separately from facts.
- 2.7 History timeline and "why did this grow" explanation per node.
- 2.8 Generic tracker module: define a new app by describing its fields (no code). This is how new apps get added by talking, and covers most small future apps.
- T2.1 Migrated tree equals old tree. T2.2 Unit test per rule and per event type. T2.3 Property test: any event order/duplication yields same tree. T2.4 Insights never write facts (no feedback loop). T2.5 Visual snapshot test of the tree at several growth stages. T2.6 Push reminder still fires. T2.7 A tracker created from a description emits valid events and grows the tree.

## Phase 3 - Jarvis v1

- 3.1 Chat page with local conversation memory.
- 3.2 Tool layer: every manifest action becomes a tool the model can call.
- 3.3 Routing: keyword/rule match first, cheap model second, larger model only on ambiguity.
- 3.4 Flow: plan, preview, confirm (per tier), execute, verify result, one-tap undo.
- 3.5 Enforce permission tiers and never-send-to-AI flags in code, not in the prompt.
- 3.6 Read Evergrove insights for context and suggestions.
- 3.7 "Why" panel: which data informed this answer or suggestion, with export/correct/revoke.
- 3.8 Suggestion throttle: no repeats, quiet hours, batch small events into one digest.
- 3.9 Add an app by talking: Jarvis builds a tracker module (2.8); for a full app it writes a ready-to-build spec.
- 3.10 Voice input (browser speech) as an add-on.
- T3.1 Routing eval set of 100+ phrases (single-app, multi-app, ambiguous, typos, adversarial), tracked misroute rate. T3.2 Meaningful actions never execute without approval. T3.3 Undo restores prior state. T3.4 Prompt-injection test: text inside imported data cannot trigger actions. T3.5 Cost and latency per request measured against budget. T3.6 Blocked-area data never appears in a model request (inspect payloads).

## Phase 4 - First apps (fastest tree growth and money savings)

Each app below gets: page, manifest, events, Evergrove rules, Jarvis eval cases, and tests T-A (unit), T-B (contract: emits only valid events), T-C (talk to Jarvis, app changes, log entry, tree grows), T-D (works standalone and offline).

- 4.1 Daily/weekly tasks and habits: recurrence, streaks, completion events. Highest tree feed.
- 4.2 Calendar: events, reschedule, conflicts, timezones, recurrence. Bill due dates and task deadlines show up here.
- 4.3 Money/budget (tracking only: no bank linking, no real money in the app, no money movement): log purchases by typing or telling Jarvis, categories, budget periods, bills and subscriptions with due dates, savings goals, recurring-charge detection, "cancel candidate" flags, late-fee prevention reminders. Optional CSV import.
- 4.4 Records / done log: bills paid, things completed, receipts, warranties, insurance and tax deadlines.
- 4.5 Body/exercise: workouts, sets, duration, weekly volume.
- 4.6 Goals: goal to milestones to linked tasks; links into Evergrove and later Compass.
- 4.7 Money extensions, all manually entered: account and net-worth overview, debt payoff planner, investment holdings tracker, insurance and tax calendar, and general-guidance insights (informational patterns and tradeoffs, not personalized investment advice).
- T4.money Integer-cent math and rounding, duplicate CSV import is idempotent, budget-period edge cases, money data blocked from AI by default.

## Phase 5 - Health and self

- 5.1 Health/diet: meals, macros, weight trend.
- 5.2 Mind: journal and mood, check-ins (explore scope with you first).
- 5.3 Self-care: rest, recovery, routines.
- T5 Sensitive-data defaults ON, gentle mode respected, no medical claims.

## Phase 6 - Growth

- 6.1 Learning: courses, books, study sessions, spaced review.
- 6.2 Career: roles, skills, applications, wins log.
- 6.3 Side jobs/hustles: opportunity list, pipeline, income tracking (links to Money).
- 6.4 Creativity: projects, sessions, ideas.

## Phase 7 - Life admin

- 7.1 Relationships: people library (birthdays, likes, gift ideas, last contact), reminders through Calendar.
- 7.2 Home: chores, maintenance schedule, household documents, subscriptions overlap with Money, pets and caregiving.
- 7.3 Travel: trips, itineraries, budgets (links to Money), memories.

## Phase 8 - Compass and vault

- 8.1 Compass: values, long-term goals, decision journal, annual life review.
- 8.2 Vault: identity documents, legal records, emergency contacts, contingency plans (encrypted, local-first, never sent to AI).
- 8.3 Digital security checklist.
- T8 Vault data unreadable without the key, export/restore drill, emergency-access flow tested.

## Phase 9 - Hardening (also runs continuously)

- Full security review, restore-from-backup drill, performance check with a year of synthetic data, installable mobile app, push notifications generalized for every module, accessibility pass, documentation, monthly cost review.
- Any new idea: it comes in through the Phase 2.8 tracker (no code) or gets a manifest and joins the same checklist.

## Keeping Project Jarvis near $0

- Hosting and storage: local-first data on your device and free tiers only; no paid databases, no bank-linking services.
- AI: rules before models, cheapest model for routing, cached prompts, a hard monthly cap; an on-device or free-tier model for routine cases if quality allows.
- Separate from all of the above: the Money app (Phase 4.3) is purely your personal budget, bills and savings.
