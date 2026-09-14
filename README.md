# Evergrove

A living skill tree for your life. Tell it what you just did — a workout, a
chapter read, a hard conversation, a habit kept — and it grows a real branch
for it. Every part of your life (health, mind, discipline, craft,
relationships, creativity, inner life) gets its own limb that thickens,
extends, and blossoms as you put time into it.

- **Vite + React**, Tailwind for styling, Framer Motion for the tree's growth
  animations.
- A procedurally generated SVG tree — deterministic per your data, so it only
  changes shape when your actual progress changes, never randomly.
- One text box: "what did you just do?" → a Vercel serverless function calls
  the Claude API to turn that into structured XP updates against your
  existing skills (reusing skill names it already knows about, so "ran" and
  "running" don't become two different branches).
- Everything lives in **your browser's localStorage** — no accounts, no
  database. Export/import a JSON backup from Settings any time.
- A floating "buddy" widget in the corner you can check throughout the day,
  and a best-effort end-of-day browser notification if nothing's logged yet.

## Local setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

- `ANTHROPIC_API_KEY` — a pay-per-token key from
  [console.anthropic.com](https://console.anthropic.com). This is separate
  from any Claude.ai / Claude Code subscription — using it here doesn't touch
  that usage. Cost is tiny for personal daily use (a few cents a month with
  the default Haiku model).
- `APP_ACCESS_CODE` (optional but recommended once deployed) — a passphrase
  only you know, so a stranger who stumbles on your live URL can't spend your
  API budget. If you set it here, enter the same value once in the app's
  Settings panel.

```bash
npm run dev
```

The AI parsing lives in a Vercel serverless function (`/api/parse-entry.js`);
a small Vite middleware (`vite.config.js`) emulates that route during local
dev, so `npm run dev` alone is enough — no Vercel CLI/login needed locally.

## Deploy

1. **Push to GitHub** — create a new repo (e.g. via
   [github.com/new](https://github.com/new)) and push this project to it.
2. **Import into Vercel** — [vercel.com/new](https://vercel.com/new), import
   the GitHub repo. Vercel auto-detects Vite.
3. Add the same environment variables from `.env` in the Vercel project's
   **Settings → Environment Variables** (`ANTHROPIC_API_KEY`, optionally
   `ANTHROPIC_MODEL` and `APP_ACCESS_CODE`).
4. Deploy. On first visit, open **Settings** in the app and paste the
   `APP_ACCESS_CODE` you set (if any) so the app can talk to your API route.

## The tree, mechanically

- Seven fixed **domains** (the main limbs): Health & Fitness, Mind &
  Learning, Discipline & Habits, Craft & Career, Relationships & Social,
  Creativity & Expression, Inner Life & Purpose. See `src/lib/domains.js`.
- **Skills** (the twigs) are discovered dynamically — the first time you
  mention "guitar" it sprouts as a new skill under Creativity; every mention
  after that adds XP to the same one.
- XP → level uses a gentle-then-steepening curve (`src/lib/treeEngine.js`) so
  leveling stays meaningful for months of daily use.
- The SVG geometry (`src/lib/treeGeometry.js`) is seeded per domain/skill id,
  so the shape is stable across reloads and only grows when the underlying
  data does.

## Notes on the AI parsing

The serverless function forces the model to respond through a strict tool
schema (fixed domain enum, clamped XP range 1-40, max 6 updates per entry)
and re-validates everything server-side before it ever reaches your data —
an out-of-range or malformed response is clamped or dropped rather than
corrupting your tree. If an entry is vague or isn't a real activity, it
returns zero updates and asks you to rephrase instead of guessing.
