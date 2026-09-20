# Project Jarvis - v1 spec

Code follows this document. If code and spec disagree, fix one of them on purpose.

## 1. Shape of the system

```
You -> Jarvis (chat) -> command channel -> module actions -> append events -> shared log
                                                                     |
                     Evergrove rules fold the log into the tree <----+
                     insights (never facts) -> Jarvis context
```

- One repo, one deployment. Every app is a module with a page at `#/app/<id>`, usable without Jarvis.
- Modules never call each other. Jarvis calls module actions; modules append events; Evergrove and every module read the log.
- The log is local-first (IndexedDB) and syncs between devices as end-to-end encrypted ciphertext through a free-tier relay. The server never sees plaintext.

Decision recorded: apps are event-sourced, so the log carries each app's full domain events, not just references. This is simpler than "log points to app databases", syncs every app for free, and is rebuildable. It is safe because there is one user and the log is encrypted in transit and at rest on the relay.

## 2. Event format (schema version 1)

```
id           string, unique. uuid for live events, deterministic for migrated/periodic ones
v            1
type         "<noun>.<verb>" e.g. task.completed, tracker.entry, skill.practiced
app          module id that wrote it (tasks, money, body, evergrove, jarvis, ...)
area         one of: health mind discipline craft social creativity inner
occurredAt   ISO time the thing happened
recordedAt   ISO time it was written (never used to rewrite the past)
actor        user | jarvis | migration | system
correlationId  optional, groups events from one Jarvis request
supersedes   optional event id whose effect this event cancels
data         object, max 8 KB
```

Rules:
- Append-only. Nothing is edited or deleted. The store exposes no update or delete.
- Appending an id that already exists is a no-op (idempotent).
- A correction is a new event with `supersedes`. `event.reversed` is a pure cancel. Any other type with `supersedes` is cancel-and-replace. Reversing a reversal restores the original.
- Derived state is computed by sorting events by `occurredAt`, then `recordedAt`, then `id`, so any arrival order gives the same result.

## 3. Module manifest

```
id, name, area, icon, description
sensitive       true = its context summary is never sent to the AI unless you allow it
actions[]       { name, description, tier, input (JSON-schema subset), run(args, ctx) -> { summary, events } }
derive(events)  the module's own state from the log
context(state)  short text for Jarvis (omitted when sensitive)
maintenance     optional idempotent startup job that appends deterministic-id events
```

Permission tiers per action:
- `auto`: runs immediately (logging a workout, checking a habit).
- `ask`: Jarvis shows a preview and waits (reschedule, cancel, delete, create an app).
- `suggest`: Jarvis may only describe it, never run it.
Tiers are enforced in code before an action runs, never by trusting the model.
Anything you type into chat is by definition shared with the model. "Never send" covers stored data and summaries. Growth that comes from a private tracker (health, mind, Compass, or one you mark private) is left out of the tree summary unless that tracker is shared.

## 4. Evergrove growth rules (versioned; rules version 1)

| Event | Growth |
|---|---|
| `skill.practiced` | data.domain/skillId/skillName, xp 1-40 |
| `skill.added` | creates the skill at 0 xp |
| `tracker.entry` | from the tracker's growth config (flat xp or per-unit of a field, clamped) |
| `task.completed` | 2 xp x effort (1-3), skill "Getting things done" in discipline; or the linked goal's area |
| `habit.checked` | 4 xp once per habit per day, skill = habit name, in the habit's area |
| `goal.milestone.done` | 8 xp, skill = goal title, in the goal's area |
| `money.bill.paid` | 3 xp on or before due date, skill "Paying bills on time" (discipline) |
| `money.goal.contributed` | clamp(round(cents / 2000), 1, 15), skill "Saving" (discipline) |
| `money.month.closed` | 10 xp if spending stayed within every budget, skill "Budgeting" (discipline) |
| `people.contact.logged` | 4 xp, skill "Staying connected" (social) |
| calendar, purchases, balances | no xp (data only) |

Principles: tree never shrinks, areas can be paused (gentle mode: no nudges, no quiet-area insights), effective events only (reversed ones count for nothing). Rule changes bump the rules version and the tree is rebuilt from the log.

## 5. Shared time and money conventions

- Times are ISO strings; user-facing dates are local calendar dates (`YYYY-MM-DD`) computed on the device.
- Money is integer cents. No floating point arithmetic on money anywhere.

## 6. Sync (v1)

- Key = PBKDF2(passphrase) -> AES-GCM-256. Vault id = hash of the key, so different passphrases never mix.
- Client pushes events not yet pushed as `{id, iv, ciphertext}`; relay keeps an append-only list plus a set of ids (dedupe). Client pulls from a cursor, decrypts, validates, appends.
- Wrong passphrase = every item fails to decrypt = clear error, nothing written.

## 7. Cost guardrails

- Monthly AI cap (default $2) enforced on the server from real token usage; requests are refused once reached.
- Cheapest model by default; tools use one shared tracker tool instead of one tool per tracker; prompt caching where supported.
- Routing order: exact commands are matched on the device first (free, offline); then the cheap model; a stronger model is tried once only when the cheap model's answer is unusable (an invented tool, arguments that break the schema, or no answer). A clarifying question is never escalated. Every call, escalated or not, counts against the same cap.
- The routing eval (130+ phrases: single, multi-app, typos, ambiguous, adversarial) records misroute rate, latency and cost per request; see docs/SECURITY.md for the release checklist.
- Hosting on free tiers only. No bank linking, no paid services.

## 8. Paper test (all walked through the code as tests)

1. Log "ran 3 miles" -> skill.practiced -> Running grows. 2. Same event applied twice -> same tree. 3. Undo it -> tree back to before. 4. Undo the undo -> restored. 5. Event recorded a day late with an earlier occurredAt -> streak computed on occurredAt. 6. Two devices append offline then sync -> identical logs. 7. Habit checked twice same day -> 4 xp once. 8. Task completed then reopened -> xp removed. 9. Bill paid late -> no xp. 10. Purchase logged -> no xp, budget updates. 11. Month closed twice -> one event. 12. Calendar event rescheduled and cancelled -> final state cancelled. 13. Jarvis proposes a delete -> nothing runs until approved. 14. Injection text in a task title cannot approve an action. 15. Old localStorage tree migrated -> identical tree.

## 9. Version 2 (built on the `v2` branch)

Version 2 keeps everything above and changes the shape of the site, not the data. The design is in `docs/v2/`:

- `ARCHITECTURE.md`: one address, one app per path, the route table, the package layout and the boundary rule.
- `JARVIS-PERSONALITY.md`, `MEMORY-SPEC.md`, `FEEDBACK-SPEC.md`: who Jarvis is, what he remembers, when he speaks up.
- `COST-PLAN.md`: the $2 a month AI cap stays; what fits inside it.
- `CUTOVER.md`, `ACCEPTANCE.md`, `PAPER-TEST.md`: how it goes live, how you check it, and the scenarios walked before any code.

Decisions: free address kept forever, one address for all apps (Jarvis at `/jarvis` as its own installable app), AI cap unchanged at $2, Jarvis speaks up unprompted only when necessary, encryption at rest parked. The stored format is unchanged; new event types are ignored by version 1 code.

### 9.1 What version 2 adds to the model

New event types (all optional for version 1, which ignores them): `memory.noted`, `memory.revised`, `memory.forgotten` (Jarvis's notes; forgetting is an event, nothing is deleted from the log), `note.shown` (a note was displayed: kind, key, day), `feedback.given` (a rating of a note or a reply, or an unmute), `weekly.polished` (the AI's wording of a week, kept so it is asked for once). Events may carry an optional `device` field. Memory is an internal module (not an app in the grid): its actions `remember`, `forget` and `revise` all ask first, except that a typed "remember that ..." is the user's own command.

**Memory selection** is a local rule, not an AI call: private notes are left out unless "Memory" is shared, preferences/routines/goals rank above facts, words shared with the message and recency raise a note, and at most 12 notes / about 1,600 characters are sent, as a marked block of data that the server cleans and caps.

**Observations** (`packages/rules/src/observations.js`) are sixteen pure functions of the log, each with an id, a priority, a privacy class, a cooldown and three wordings; `chooseNotes` applies the limits (a per-day count by the "Jarvis speaks up" setting, cooldowns from `note.shown`, quiet hours 22:00-07:00, muting from `feedback.given`, paused areas). The weekly review (`weekly.js`) is a pure function of the last full week. The evening briefing adds one generic line and, on Sundays, "your weekly review is ready".

**AI purposes.** `/api/jarvis` takes `purpose`: `chat` (tools, the default), or the optional `weekly` (polish the review's wording) and `opinion` (an honest opinion on request), which have no tools and their own instructions. The server refuses optional purposes at 80% of the monthly cap, the weekly one beyond 10% of the cap, and everything at 100%; spend is recorded per purpose and in total. Chat requests cache the tool list, the fixed instructions and the once-a-day material together, and send only who you are, the time and your data uncached.

**Routes and layout.** One address; a path per app (`/tasks`, `/money`, ..., `/jarvis`, `/jarvis/memory`, `/jarvis/weekly`, `/jarvis/settings`, `/jarvis/brief`, `/t/<tracker>`), each with its own generated page and manifest from one route table; old `#/...` links redirect. Packages import only downward (core, modules, rules, ui, kit, apps) and a test enforces it.
