// Runs the real-model cost measurement. Kept as a script so the environment
// variable works the same on Windows, macOS and Linux.
import { spawnSync } from 'node:child_process'

const result = spawnSync(process.execPath, ['--env-file=.env', 'node_modules/vitest/vitest.mjs', 'run', 'apps/jarvis/src/lib/measure.eval.test.js'], {
  stdio: 'inherit',
  env: { ...process.env, JARVIS_MEASURE: '1' },
})
process.exit(result.status ?? 1)
