// When „Изпрати протокол“ shows: from the polls closing (20:00 Sofia) until the end of the third day after (election.ts).
// The browser also reads endOfElectionDayTimestamp from the API's /results/meta.json, like the old results site,
// and re-checks the clock every 30 seconds, so a page left open at 19:59 shows the link at 20:00.
// Off production (staging, previews, local dev), ?protokol-test=1 opens the window for this browser tab.
import { useEffect, useState } from 'react'
import { isProductionHost } from '../home/violations'
import { tibroishApi } from './api-base'
import { currentOrNextProtocolWindow, isProtocolOpen, protocolWindows } from './election'

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

const TEST_KEY = 'ti-broish-protokol-test'
const TICK_MS = 30_000

let metaRequest: Promise<string | null> | null = null

export async function fetchElectionEnd(fetcher: Fetch = (input, init) => fetch(input, init), api = tibroishApi()) {
  try {
    const response = await fetcher(`${api}/results/meta.json`, { headers: { Accept: 'application/json' } })
    if (!response.ok) return null
    const meta = (await response.json()) as { endOfElectionDayTimestamp?: unknown }
    return typeof meta.endOfElectionDayTimestamp === 'string' ? meta.endOfElectionDayTimestamp : null
  } catch {
    return null
  }
}

/** Only near an election night, so ordinary days do not call the API on every page. */
function nearElection(now: Date) {
  const day = 24 * 60 * 60 * 1000
  return protocolWindows().some((window) => now.getTime() > window.opens.getTime() - day && now < window.closes)
}

function electionEnd() {
  if (!nearElection(new Date())) return Promise.resolve(null)
  metaRequest ??= fetchElectionEnd()
  return metaRequest
}

/** Staging and local only: ?protokol-test=1 (or =0 to undo) forces the window open for this tab. */
export function protocolTestOverride(): boolean {
  if (typeof window === 'undefined' || isProductionHost(window.location.hostname)) return false
  try {
    const flag = new URLSearchParams(window.location.search).get('protokol-test')
    if (flag === '1') window.sessionStorage.setItem(TEST_KEY, '1')
    if (flag === '0') window.sessionStorage.removeItem(TEST_KEY)
    return window.sessionStorage.getItem(TEST_KEY) === '1'
  } catch {
    return false
  }
}

export function useProtocolWindow() {
  const [now, setNow] = useState(() => new Date())
  const [end, setEnd] = useState<string | null>(null)
  const [testOpen, setTestOpen] = useState(false)
  useEffect(() => {
    let cancelled = false
    setTestOpen(protocolTestOverride())
    setNow(new Date())
    void electionEnd().then((value) => {
      if (!cancelled) setEnd(value)
    })
    const timer = window.setInterval(() => setNow(new Date()), TICK_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])
  return {
    open: testOpen || isProtocolOpen(now, end),
    test: testOpen,
    window: currentOrNextProtocolWindow(now, end),
    now,
  }
}

export function useProtocolOpen() {
  return useProtocolWindow().open
}
