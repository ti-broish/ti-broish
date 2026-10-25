import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // One dev server and one local D1 serve every spec, and specs also seed it with `wrangler d1 execute --local`.
  // Two workers writing at once got SQLITE_BUSY and failed a random spec, so the specs run one at a time.
  workers: 1,
  globalSetup: './e2e/global-setup.ts',
  use: { baseURL: 'http://127.0.0.1:3000', trace: 'retain-on-failure' },
  webServer: {
    command: 'pnpm exec vite dev --host 127.0.0.1 --port 3000 --strictPort',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    // Signups are closed in production (src/signup/signups-closed.ts). The specs keep the signup flow covered.
    // VITE_RESULTS_FIXTURES: the map and unit pages read fixed data (src/home/results-fixtures.ts), not api.tibroish.bg.
    env: { VITE_SIGNUPS_OPEN: '1', VITE_RESULTS_FIXTURES: '1' },
    stderr: 'pipe',
  },
})
