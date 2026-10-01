import type { Profile } from './model'

export function profileStamp(profile: Profile) {
  return JSON.stringify(profile)
}

export function sessionProfile(
  current: Profile,
  remote: Profile,
  referrerName: string | null,
  found: { source: string; referredBy: string },
  at: string,
): Profile {
  if (profileStamp(current) !== at) return current
  return {
    ...remote,
    source: remote.source || found.source,
    referredBy: remote.referredBy || found.referredBy,
    referrerName: referrerName || '',
  }
}
