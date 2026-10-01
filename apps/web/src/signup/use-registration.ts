import { useEffect, useState } from 'react'
import { loadSignup } from './db'
import { registrationSettled, type Profile } from './model'
import { campaignFromSearch } from './rules'
import { profileStamp, sessionProfile } from './session-profile'
import { updateProfile, useProfile } from './store'

function profileIsBlank(profile: Profile) {
  return !profile.firstName && !profile.middleName && !profile.lastName && !profile.email && !profile.phone && !profile.egn && !profile.submitted
}

type SessionResult = Awaited<ReturnType<typeof loadSignup>>

let flight: { at: string; pending: Promise<SessionResult> } | null = null

export function beginSessionLoad(current: Profile) {
  if (!flight) {
    const pending = loadSignup()
      .catch(() => null)
      .finally(() => {
        if (flight?.pending === pending) flight = null
      })
    flight = { at: profileStamp(current), pending }
  }
  return flight
}

/** Drop a load that started before this browser had a session. */
export function invalidateSessionLoad() {
  flight = null
}

export function applyLoadedSession(current: Profile, remote: NonNullable<SessionResult>, at: string) {
  const found = typeof window === 'undefined' ? { source: null, referredBy: null } : campaignFromSearch(new URLSearchParams(window.location.search))
  return sessionProfile(current, remote.profile, remote.referrerName, { source: found.source || '', referredBy: found.referredBy || '' }, at)
}

/** Local profile first. A blank browser waits for the one shared session load. */
export function useRegistration() {
  const { profile, ready } = useProfile()
  const [remoteDone, setRemoteDone] = useState(false)

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    const current = beginSessionLoad(profile)
    void current.pending.then((result) => {
      if (cancelled) return
      if (result) updateProfile((latest) => applyLoadedSession(latest, result, current.at))
      setRemoteDone(true)
    })
    return () => {
      cancelled = true
    }
  }, [ready])

  const settled = ready && registrationSettled(profile)
  const pending = !ready || (profileIsBlank(profile) && !settled && !remoteDone)
  return { settled, pending }
}
