import type { Page } from '@playwright/test'
import { emptyProfile, type Profile } from '../src/signup/model'

export const SIGNUP_STORAGE_KEY = 'ti-broish-signup-prototype-v1'

export async function seedProfile(page: Page, patch: Partial<Profile>) {
  const profile = {
    ...emptyProfile(),
    ...patch,
    rounds: { ...emptyProfile().rounds, ...patch.rounds },
  }
  await page.addInitScript(
    ({ key, value }) => {
      localStorage.setItem(key, value)
    },
    { key: SIGNUP_STORAGE_KEY, value: JSON.stringify(profile) },
  )
}
