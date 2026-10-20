import { execFileSync } from 'node:child_process'
import { chromium, type FullConfig } from '@playwright/test'

/**
 * Vite dev compiles each server-function module on its first call, and that very first call can
 * fail with TanStack's „Cannot read properties of undefined (reading 'method')“ (500) while the
 * module is still being split. Open every admin page once, signed in as a throwaway admin, before
 * the specs, so those modules are compiled and a spec's first click never lands in that window.
 */
const PAGES = ['/admin', '/admin/signups', '/admin/sections', '/admin/palnomoshtni', '/admin/calls', '/admin/access']
const EMAIL = 'warmup.admin-e2e@example.com'
const SESSION = 'e2e-warmup-admin-session'
const WEB_DIR = new URL('.', import.meta.url).pathname.replace(/e2e\/$/, '')

function d1(sql: string) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'ti-broish-signup-staging', '--local', '--command', sql], { cwd: WEB_DIR, stdio: 'pipe' })
      return
    } catch (error) {
      if (attempt >= 5) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 * attempt)
    }
  }
}

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL ?? 'http://127.0.0.1:3000'
  const browser = await chromium.launch()
  const page = await browser.newPage()
  // The first request creates the local tables.
  await page.goto(`${baseURL}/admin`, { waitUntil: 'networkidle', timeout: 180_000 }).catch(() => undefined)
  d1(`INSERT INTO signups (id, email, session_token, referral_code, payload, email_confirmed, withdrawn, submitted, egn, created_at, updated_at)
VALUES ('e2e-warmup-admin', '${EMAIL}', '${SESSION}', 'e2ewarm1', '{"firstName":"Загрявка","lastName":"Админ","email":"${EMAIL}","phone":"0888000998"}', 1, 0, 1, '', datetime('now'), datetime('now'))
ON CONFLICT(email) DO UPDATE SET session_token = excluded.session_token, email_confirmed = 1;
INSERT INTO staff (email, role, invited_by, created_at) VALUES ('${EMAIL}', 'admin', 'e2e', datetime('now')) ON CONFLICT(email) DO UPDATE SET role = 'admin';`)
  try {
    await page.context().addCookies([{ name: 'tb_session', value: SESSION, url: baseURL, httpOnly: true, sameSite: 'Lax' }])
    for (let round = 0; round < 2; round += 1) {
      for (const path of PAGES) {
        await page.goto(`${baseURL}${path}`, { waitUntil: 'networkidle', timeout: 120_000 }).catch(() => undefined)
      }
    }
  } finally {
    await browser.close()
    d1(`DELETE FROM signups WHERE id = 'e2e-warmup-admin'; DELETE FROM staff WHERE email = '${EMAIL}';`)
  }
}
