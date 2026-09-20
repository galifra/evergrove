# Security notes

What Evergrove protects, how, and, just as important, what it does not. Written
for one person's personal system, so the threats are: a stranger finding the live
URL, someone with the server's stored data, someone who steals or borrows a
device, and text that tries to talk the AI into doing something.

## Where data lives

| Data | Where | Protection |
| --- | --- | --- |
| Your events (everything in the apps) | Each device's IndexedDB | Not encrypted at rest. The device lock and browser profile are the protection |
| Vault items | Inside those events | Each item is encrypted (AES-GCM) with a key derived from a separate vault passphrase that is only ever in memory while unlocked |
| Synced copy | Upstash Redis, only if you turn sync on | End-to-end encrypted (below). The server holds `{id, iv, ciphertext}` |
| Access code, sync passphrase | That browser's localStorage | Plain text on the device. Anything that can run script on the site's origin could read them, which is why there are no injection sinks (below) |
| AI key, VAPID private key, cron secret | Vercel environment variables | Server only; never sent to the browser |
| Push subscriptions | Upstash, one per device | Can only deliver a content-free wake-up |

## Controls

**Access.** Every API route calls one gate, `authorize()` (`server/auth.js`). It
compares the access code in constant time. Wrong codes are counted per address;
after 20 in an hour that address gets 429 even with the right code. In production
a missing `APP_ACCESS_CODE` rejects everything, and a missing `CRON_SECRET` means
the reminder route can't be triggered by anyone.

**Sync encryption** (`src/core/crypto.js`, `src/core/sync.js`). A key is derived
from your passphrase with PBKDF2-SHA256 (200,000 rounds) and each event is
encrypted with AES-GCM and a fresh random nonce. The vault id used to address
your data on the server is a hash derived from the passphrase. The server can see
how many blobs there are, their sizes and when they arrive; it cannot read them or
tell what app they belong to. The server validates shape and size, ignores
duplicates, and caps the length of a log.

**What the AI sees.** The request is assembled on the device
(`src/jarvis/jarvis.js`). Apps marked private (money, health, mind, Compass, vault)
are left out of that summary in code unless you share them in Settings, and the
vault has no summary at all. After each message the Jarvis page lists exactly which
apps contributed, lets you copy what was sent, jump to correct it, or stop sharing.
The API key never leaves the server.

**What the AI can do.** Only actions the apps declare, each with a tier enforced in
`src/core/registry.js`: run automatically, ask first (a click is required), or
suggest only. Arguments are validated against the action's schema; money amounts
are integer cents; every executed action writes an audit event and can be undone
with one tap. Text inside your data, imported files or a pasted email is treated as
information, and the eval set includes injection attempts that must produce no
actions.

**Spend.** A hard monthly cap (default $2) is checked on the server before every
model call, and the server prices unknown models pessimistically. Settings shows
spend and a monthly cost history.

**Web.** No `innerHTML`, `dangerouslySetInnerHTML`, `eval` or `document.write`
anywhere in the app; React escapes everything. Headers set in `vercel.json`: a
strict Content-Security-Policy (own scripts only, no inline scripts, own API only),
`nosniff`, no referrer, no framing, and camera, location and payment switched off.
The only third party is Google Fonts, for typefaces.

**Notifications.** The server sends a push with no personal content; the service
worker builds the briefing on the device from local data. A lock-screen setting
chooses names or counts only.

**Dependencies.** Small on purpose. `npm audit --omit=dev` reports no known
vulnerabilities at the time of writing.

## Known limits (chosen, not overlooked)

- **No encryption at rest** for anything except Vault items. Encrypting the whole
  local store would mean the evening briefing can't be built while the app is
  locked and that a forgotten passphrase loses local data. It is a trade-off to
  decide, not a default to slip in.
- **One shared access code.** There is no per-device login. To cut off a lost
  device, change `APP_ACCESS_CODE` in Vercel and enter the new one on your devices.
  If sync is on, also switch to a new sync passphrase.
- **The sync salt is fixed** (a constant in the app), so someone holding the
  encrypted blobs could try common passphrases offline. Use a long passphrase
  (four or more random words). The 200,000 rounds slow each guess but do not replace
  a strong passphrase.
- **Exports are plain text** (Vault items stay encrypted). Keep them private.
- **Rate limiting** is keyed on the forwarded address, which is good enough to stop
  guessing but not a substitute for a long random access code.
- **The emergency sheet is plain text** by design (it is meant to be printed). It
  never contains the vault passphrase.
- **Your own device is trusted.** Malware or a browser extension with access to
  the page could read what you can.

## Version 2: one address for every app

Putting every app on one address (so `/money` and `/jarvis` are the same origin) means one script problem would reach every app's data and the access code in the browser. There is no way to fence apps from each other on one origin, so the defence is to make a script problem impossible to start and hard to use. Reviewed for version 2:

- **No way to run text as code.** A test scans all source for `dangerouslySetInnerHTML`, `innerHTML =`, `insertAdjacentHTML`, `document.write`, `eval(`, `new Function`, script addresses, `srcDoc` and `window.open`, and fails if any appears (and a check proves it would catch one). Notes, replies, titles and imported files are always rendered as text.
- **A strict content policy, held by a test.** Scripts only from this address, no inline scripts (also tested per generated page), connections only to this address, no plugins, no framing, forms and base only to this address; the only outside hosts are the two font hosts.
- **Links only go inward.** A link target that is not a path on this address (a script address, another site, `//host`, a backslash, a control character) becomes the home page; tested.
- **The access-code gate is on every server route**, and comes before any model call, store read or write; a test lists the routes so a new one cannot be added without it. The scheduled job uses the cron secret instead. The health check proves the gate on a live address without changing anything.
- **The service worker never caches an API answer** and is always served fresh.
- **What Jarvis learns and keeps.** A memory note is data, never an instruction: it reaches the AI as a marked, cleaned, capped block, and a hostile note triggers no action and cannot approve itself (tests). Private notes and private apps are only sent when shared. A rating of a reply keeps the words only if no private app was touched; otherwise only the action names. The optional AI uses (weekly write-up, opinions) are built without private names, amounts or notes.
- **Spend cannot be talked around.** The cap, the 80% ration line and the 10% share for the weekly write-up are enforced on the server from real token usage; the client's copy of the rules only decides what to show.
- **Remaining, chosen limits**: everything above assumes the page itself is not compromised, and the chat history and settings sit in the browser's local storage in plain text (encryption at rest is parked until after version 2). Two devices opened at the same moment can each show a new note before their logs meet.

## If something leaks

| What | Do this |
| --- | --- |
| The AI key | Revoke it in the Anthropic console, create a new one, update `ANTHROPIC_API_KEY` in Vercel, redeploy. (A key pasted into a chat or a screenshot should be treated as leaked.) |
| The access code | Change `APP_ACCESS_CODE` in Vercel, redeploy, enter the new one on each device |
| The sync passphrase | Turn sync off, choose a new passphrase, turn it on again on each device |
| The Upstash token | Rotate it in the Upstash console and update `KV_REST_API_TOKEN` |
| A lost phone | Change the access code; the phone can then no longer sync or use the AI. Remove its push subscription by redeploying with a new `VAPID` keypair if you want it silenced too |

## Review checklist (run before each release)

1. `npm test`, `npm run lint`, `npm run build` all clean.
2. `npm audit --omit=dev` reports nothing.
3. Injection sinks: `tests/security.test.js` scans for them (`npm test`).
4. Every API route starts with `authorize()` (or the cron secret check): the same test lists the routes.
5. Nothing new is sent to the AI without going through `contextSources`, and the "private" flag is set on any new app that holds sensitive data.
6. Any new action has a tier, a schema, a test that it emits valid events, and routing phrases in `apps/jarvis/src/lib/evalCases.js`.
7. `npm run eval` misroute rate is at or under 10%, and the injection cases still produce no actions.
8. `npm run health -- --url <address>` on a preview before going live and on the live address after.
