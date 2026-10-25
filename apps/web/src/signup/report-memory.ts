export interface RememberedReport {
  id: string
  secret: string
  kind: 'violation' | 'protocol' | 'call'
  /** 'api' for signals and protocols sent to the Ти Броиш API; absent for older reports kept in D1. */
  source?: 'api'
  createdAt?: string
  title?: string
  photoCount?: number
}

const KEY = 'ti-broish-reports-v1'

export function readReports(): RememberedReport[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) || '[]') as RememberedReport[]
    return Array.isArray(parsed) ? parsed.filter((item) => item?.id && item?.secret) : []
  } catch {
    return []
  }
}

export function rememberReport(item: RememberedReport) {
  try {
    const all = readReports().filter((current) => current.id !== item.id)
    all.push(item)
    window.localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    // Some browsers block storage. The signal is already sent.
  }
}
