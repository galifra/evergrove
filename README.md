# Evergrove

A living skill tree for your life, and the hub of a small set of personal apps.
Tell it what you did (typing, or your voice) and a real tree grows a branch for
it. Every area of life (health, mind, discipline, craft, relationships,
creativity, inner life) gets its own limb that thickens as you put time into it.

Live: <https://evergrove-neon.vercel.app>. Everything is built to cost close to
nothing to run: free hosting tiers, data on your own devices, and a hard cap on
AI spend.

## What is in it

- **Evergrove (the tree).** Reads the shared event log and grows. The tree never
  shrinks; mistakes are fixed with correction events, never by editing history.
- **MOXIE (`/moxie`), a butler and a friend.** Type or speak. He greets you by name,
  remembers what you tell him (a visible, editable list of short notes, never saved
  without your say), speaks up unprompted only when something needs you (at most two
  notes a day, never at night, each one rateable, "not useful" silences a kind for a
  month), gives a weekly review built on the device, and gives an honest opinion when
  you ask. Exact, simple commands ("undo", "brief me", "what's today", "remember that",
  "weekly review") are handled on the device for free. Everything else goes to a
  small Claude model that can only use the actions the apps declare, each with a
  permission tier (runs automatically, asks first, or suggestion only) that is
  enforced in code, not in the prompt.
- **Apps.** Tasks and habits (with repeating tasks and goal links), Calendar
  (repeating events, conflicts), Money (tracking only: purchases, budgets, bills,
  savings, debts and a payoff planner, holdings, deadlines, CSV import), Goals,
  People, Vault (encrypted), plus twelve trackers (body, health and diet, mind,
  self-care, learning with spaced review, creativity, career, side hustles,
  travel, home, records, Compass). New trackers can be made by talking to MOXIE;
  a whole new app becomes a ready-to-build spec on the Apps page.
- **Today and the evening briefing.** One derived list of what needs you, and a
  real push notification each evening about tomorrow, built on the device.
- **Sync.** Optional, end-to-end encrypted between your phone and laptop.

## How it fits together

Everything an app does is an append-only event (`noun.verb`, with a type,
version, time, actor and small JSON data). The current state of every app is a
pure function of the log. Because of that: undo is a reversing event, two
devices merge by taking the union of events (adding the same event twice does
nothing), and "Check my data" can rebuild everything from scratch and compare.

One address serves everything: each app has its own path (`/tasks`, `/money`, `/jarvis`, ...),
its own installable page and manifest, generated from one route table. The code is split into
packages that may only import downward (a test enforces it):

```
packages/core     event log (IndexedDB), registry + command channel, crypto, sync
packages/modules  one file per app: state derived from the log, and its actions (incl. MOXIE's memory)
packages/rules    growth rules, tree, Today, briefing, observations and the weekly review, log viewer, routes
packages/ui       shared components and styles
packages/kit      the shell: runtime, router, settings, service worker, the AI budget panel
apps/evergrove    the tree and every app screen
apps/jarvis       MOXIE: chat, notes, memory, weekly review, settings (folder kept its old internal name)
site, public      generated pages, manifests and icons for every path (`npm run gen`)
api               serverless routes: jarvis, usage, sync, parse-entry, save-subscription, send-reminder
server            auth, key-value store, spend meter and ration rules, prompts, time helpers
scripts           generators, the health check, and the real-model checks
docs              SPEC.md (design), SECURITY.md, BACKLOG.md (v1), BACKLOG-V2.md, v2/ (specs, results, cutover)
```

## Run it locally

```bash
npm install
cp .env.example .env    # then fill it in, see below
npm run dev
```

A small Vite middleware serves every `api/<name>.js` route during `npm run dev`,
so no Vercel login is needed locally. Without Upstash variables the server uses
an in-memory store, which is fine for development.

| Command | What it does |
| --- | --- |
| `npm test` | Unit and integration tests (fast, free, no network) |
| `npm run lint` | oxlint |
| `npm run build` | Production build, including the service worker |
| `npm run health` | The whole health check in one command: tests, lint, generated files, build, audit. With `-- --url <address>` it also requests every path of a running site and checks headers and the access-code gate (read-only) |
| `npm run eval` | The MOXIE routing eval against the real model. Costs about half a dollar; run it deliberately |
| `npm run tone` | 25 situations through the real model, written to `docs/v2/TONE-SAMPLE.md` for you to read (about 10 cents) |
| `npm run feedback` | His opinions and weekly write-up on made-up lives, written to `docs/v2/FEEDBACK-SAMPLE.md` (about 6 cents) |
| `npm run measure` | Measures the real cost per request type into `docs/v2/COST-MEASURED.md` (about 6 cents) |
| `npm run gen` | Regenerates the per-path pages, manifests and icons from the route table (`npm run build` refuses to run if they are stale) |

## Environment variables

| Name | Needed for |
| --- | --- |
| `ANTHROPIC_API_KEY` | MOXIE. A separate pay-per-token key, not a Claude subscription |
| `ANTHROPIC_MODEL` | Optional, defaults to a small Haiku model |
| `APP_ACCESS_CODE` | Required in production. Every API route rejects requests without it |
| `AI_MONTHLY_CAP_USD` | Optional hard cap on AI spend, default 2 |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Upstash Redis: spend meter, sync relay, push subscriptions |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_CONTACT_EMAIL` | Web push |
| `CRON_SECRET` | Required in production. Only the scheduler may trigger reminders |

In production the server refuses to run without `APP_ACCESS_CODE` and
`CRON_SECRET` instead of quietly allowing everyone.

## Deploy

1. Push to GitHub and import the repo in Vercel (it detects Vite).
2. Add the environment variables above in the project settings.
3. Connect an Upstash Redis store to the project.
4. Deploy. In the app, open Settings and enter the access code once per device.

Going live with version 2 (and rolling back) is written out in `docs/v2/CUTOVER.md`,
with `docs/v2/ACCEPTANCE.md` as the walkthrough to run afterwards.

The scheduler in `vercel.json` calls `/api/send-reminder` twice a day (so
daylight saving never drops a reminder). The server only sends a content-free
wake-up; the service worker builds the actual briefing from the data on the
device.

## Using it on a second device

1. On the first device: Settings, turn on sync, choose a sync passphrase.
2. On the second device: on the welcome screen choose "I already use Evergrove on
   another device", then enter the access code and the same sync passphrase.

The passphrase never leaves the device. The server stores only encrypted blobs.
If you forget the passphrase, the synced copy cannot be read; your local data is
unaffected, and Settings has a full export and import.

## Adding something new

- **A tracker** (things you log with a few fields): ask MOXIE ("make me a
  tracker for houseplants"), or add it to `src/evergrove/trackers.js`.
- **A whole app**: ask MOXIE for it (it saves a spec), or add a module in
  `src/modules` with `derive`, an optional `context`, and `actions` (each with a
  tier), register it in `src/modules/index.js`, add a page, growth rules if it
  should grow the tree, and tests. `src/modules/vault.js` is the smallest
  example; `src/modules/tasks.js` shows actions and tiers.

Every new action needs a test that it emits only valid events, and MOXIE
routing phrases in `src/jarvis/evalCases.js`.

## Backups and recovery

Settings has Export and Import (a JSON file of every event; importing twice does
nothing) and "Check my data" (rebuilds everything from the log and compares).
The restore drills are tests: `src/app/backup.test.js` and
`src/modules/vault.test.js`.

## Troubleshooting

- **"Invalid app code" or sync failing**: the access code is missing or wrong on
  that device. Settings, paste it, Save.
- **No evening notification**: notifications must be allowed for the site, the
  reminder switched on in Settings on that device, and on iPhone the app added
  to the Home Screen. "Show me tonight's notification now" tests the device half.
- **AI stopped answering**: the monthly cap was reached. Settings shows spend and
  a monthly cost review; everything else keeps working.

See `docs/SECURITY.md` for what is protected, what is not, and why.
