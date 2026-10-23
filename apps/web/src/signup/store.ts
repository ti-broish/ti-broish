import { useEffect, useState } from 'react'
import { emptyProfile, type Profile } from './model'

const KEY = 'ti-broish-signup-v1'
const LEGACY_KEY = 'ti-broish-signup-prototype-v1'

const listeners = new Set<() => void>()

/** localStorage is a cache only. D1 + tb_session is the source of truth after loadSignup. */
function read(): Profile {
  if (typeof window === 'undefined') return emptyProfile()
  try {
    let raw = window.localStorage.getItem(KEY)
    if (!raw) {
      const legacy = window.localStorage.getItem(LEGACY_KEY)
      if (legacy) {
        window.localStorage.setItem(KEY, legacy)
        window.localStorage.removeItem(LEGACY_KEY)
        raw = legacy
      }
    }
    if (!raw) return emptyProfile()
    const parsed = JSON.parse(raw) as Partial<Profile> & { demoState?: unknown }
    delete parsed.demoState
    return { ...emptyProfile(), ...parsed }
  } catch {
    return emptyProfile()
  }
}

function write(next: Profile) {
  window.localStorage.setItem(KEY, JSON.stringify(next))
  listeners.forEach((listener) => listener())
}

export function updateProfile(patch: Partial<Profile> | ((profile: Profile) => Profile)) {
  const current = read()
  const next = typeof patch === 'function' ? patch(current) : { ...current, ...patch }
  write(next)
}

/** sessionStorage: this tab already chose „Продължи своето записване“ for this e-mail. */
export const SIGNUP_CHOICE_KEY = 'ti-broish-signup-choice'

export function markOwnSignup(email: string) {
  if (typeof window === 'undefined' || !email) return
  window.sessionStorage.setItem(SIGNUP_CHOICE_KEY, email.trim().toLowerCase())
}

export function ownSignupMarked(email: string) {
  if (typeof window === 'undefined' || !email) return false
  return window.sessionStorage.getItem(SIGNUP_CHOICE_KEY) === email.trim().toLowerCase()
}

/** „Запиши друг човек“: forget the cached profile in this browser. */
export function resetProfile() {
  window.sessionStorage.removeItem(SIGNUP_CHOICE_KEY)
  write(emptyProfile())
}

export function useProfile() {
  const [profile, setProfile] = useState<Profile>(emptyProfile)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setProfile(read())
    setReady(true)
    const listener = () => setProfile(read())
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  return { profile, ready }
}

export function ensureReferralCode(profile: Profile) {
  const existing = profile.referralCode || profile.inviteCode
  if (existing) {
    if (profile.referralCode !== existing || profile.inviteCode !== existing) {
      updateProfile({ referralCode: existing, inviteCode: existing })
    }
    return existing
  }
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  let code = ''
  for (const byte of bytes) code += alphabet[byte % alphabet.length]
  updateProfile({ referralCode: code, inviteCode: code })
  return code
}

export function ensureInviteCode(profile: Profile) {
  return ensureReferralCode(profile)
}
