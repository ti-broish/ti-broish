import type { Page } from '@playwright/test'
import { emptyProfile, nextAssignment, type Profile } from '../src/signup/model'

export function nextWaveLabel(rounds: Profile['rounds'] = { first: true, runoff: true }) {
  return nextAssignment({ rounds }).label
}

export const SIGNUP_STORAGE_KEY = 'ti-broish-signup-v1'

// Playwright does not define the order of init scripts. A later seed must still
// replace an earlier one when a test calls seedProfile twice.
let seedStamp = 0

export async function seedProfile(page: Page, patch: Partial<Profile>) {
  const profile = {
    ...emptyProfile(),
    ...patch,
    rounds: { ...emptyProfile().rounds, ...patch.rounds },
  }
  seedStamp += 1
  await page.addInitScript(
    ({ key, value, stamp }: { key: string; value: string; stamp: number }) => {
      const mark = `${key}:stamp`
      const current = Number(localStorage.getItem(mark) || 0)
      if (stamp < current) return
      localStorage.setItem(key, value)
      localStorage.setItem(mark, String(stamp))
    },
    { key: SIGNUP_STORAGE_KEY, value: JSON.stringify(profile), stamp: seedStamp },
  )
}
