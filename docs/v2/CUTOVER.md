# Cutover and rollback plan (P0.10, updated for Phase 9)

Version 2 is built on the `v2` branch and pushed to `https://github.com/galifra/JARVIS` (branch `main`). **Nothing has been deployed.** Production (`master` on `galifra/evergrove`, Vercel project `focus23/evergrove`) still runs version 1, and a push to `master` deploys to production automatically, so nothing goes to `master` without your say.

## State of the safety net (checked)

- Tag `v1-final` is commit `f679c7e`, the same commit `master` is on. It is in your local copy and in the JARVIS repository. (It is not on `galifra/evergrove`, only the commit is; that is enough, since `master` is that commit.)
- The last version 1 production deployment, `https://evergrove-3pifn1hdv-focus23.vercel.app`, is listed as Ready. Rollback needs it.
- The stored data format has not changed: version 2 only adds event types (`memory.*`, `note.shown`, `feedback.given`, `weekly.polished`) and an optional `device` field, and version 1 ignores both.

## Before

1. **You export a backup** of your real data (Settings, Export) and keep it outside the project. *(This can only be done in your browser; it has not been done.)*
2. `npm run health` passes locally (tests, lint, generated files, build, audit).
3. The routing eval is run once on the final build (`npm run eval`, about half a dollar of API use). It must stay at 95% or better.

## Rehearsal on a preview address (needs your yes)

A preview has its own address and its own empty database, so it cannot touch your data. Two ways to get one; both publish version 2 to a private-by-obscurity Vercel address, so **do not do either without saying so**:

- `npx vercel deploy` from this folder (no `--prod`) builds the current branch to a preview address; or
- connect the JARVIS repository to a new Vercel project (its own address, its own database and cron jobs).

Then:

1. `npm run health -- --url <preview address>` reads every path, every manifest and the security headers, and checks each API refuses a request with no code.
2. Open the preview in a clean browser window. Import your backup (Settings, Import). Run "Check my data": every event valid, the tree identical.
3. Run the acceptance walkthrough (`docs/v2/ACCEPTANCE.md`).
4. Compare event count, tree, Today card, bills and tasks with production.
5. Rehearse the rollback below on the preview.

## Going live (only when you say so)

1. Fresh backup export.
2. Merge `v2` into `master` and push. Vercel deploys to production.
3. `npm run health -- --url https://evergrove-neon.vercel.app` (every path, every manifest, headers, gates).
4. Open the site once. The service worker updates in the background; the next open runs version 2. Old links redirect.
5. Run the acceptance walkthrough on production.
6. Check tonight's 9 PM briefing arrives and opens `/jarvis/brief`.

## Rollback

Data is unaffected because the stored format does not change. To roll back:

```bash
npx vercel rollback https://evergrove-3pifn1hdv-focus23.vercel.app
```

or in the dashboard, Deployments, choose the version 1 deployment, Promote to Production. Then, in git, revert the merge on `master` so the next push does not redeploy version 2. Roll back first, fix second. The service worker of version 2 is replaced by the older one on the next open; the older one ignores the new event types and keeps working.

## What must not happen

- Changing the site address.
- Deploying version 2 while a fresh backup does not exist.
- Deleting the `v1-final` tag or the old deployment for 7 days after going live.
