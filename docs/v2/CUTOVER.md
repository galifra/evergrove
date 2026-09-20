# Cutover and rollback plan (P0.10)

Version 2 is built on the `v2` branch. `master` is production and is not touched until you decide. A push to `master` deploys to production automatically, so nothing goes to `master` without your say.

## Before

1. `v1-final` tag exists on the last version 1 commit (done).
2. The last version 1 production deployment is `https://evergrove-3pifn1hdv-focus23.vercel.app` (commit `f679c7e`, tag `v1-final`). Rollback needs it.
3. You export a backup of your real data (Settings, Export) and keep it outside the project.
4. Every step of the cutover is rehearsed on a preview address first. A preview has its own address and therefore its own empty database.

## Rehearsal on a preview address

1. Push the `v2` branch. Vercel builds a preview address for it (not production).
2. Open the preview in a clean browser window. Import your backup (Settings, Import). Run "Check my data": it must say every event is valid and the tree rebuilds identically.
3. Run the acceptance walkthrough (`docs/v2/ACCEPTANCE.md`).
4. Compare: event count, tree, Today card, bills and tasks must match what you see on production.

## Going live (only when you say so)

1. Fresh backup export.
2. Merge `v2` into `master` and push. Vercel deploys to production.
3. Open the site once. The service worker updates in the background; the next open runs version 2. Old links redirect.
4. Run the acceptance walkthrough on production.
5. Check tonight's 9 PM briefing arrives and opens `/jarvis/brief`.

## Rollback (rehearsed on the preview)

Data is unaffected because the stored format does not change. To roll back:

```bash
npx vercel rollback <deployment-id-of-v1>
```

or in the dashboard, Deployments, choose the version 1 deployment, Promote to Production. Then, in git, revert the merge on `master` so the next push does not redeploy version 2. Roll back first, fix second. The service worker of version 2 is replaced by the older one on the next open; the older one ignores the new event types and keeps working.

## What must not happen

- Changing the site address.
- Deploying version 2 while a fresh backup does not exist.
- Deleting the `v1-final` tag or the old deployment for 7 days after going live.
