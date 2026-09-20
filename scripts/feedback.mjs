// Runs the real-model sample of his opinions and weekly polish. A script so the
// environment variable works the same on Windows, macOS and Linux.
import { spawnSync } from 'node:child_process'

const result = spawnSync(process.execPath, ['--env-file=.env', 'node_modules/vitest/vitest.mjs', 'run', 'apps/jarvis/src/lib/feedback.eval.test.js'], {
  stdio: 'inherit',
  env: { ...process.env, JARVIS_FEEDBACK: '1' },
})
process.exit(result.status ?? 1)
