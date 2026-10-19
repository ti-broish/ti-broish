import { useEffect, useState } from 'react'
import { adminReservedSections } from '../../signup/reserved-sections-admin'

export function ReservedBadge({ org, conflict = false }: { org: string | null | undefined; conflict?: boolean }) {
  if (!org) return null
  return (
    <span
      className="inline-flex min-h-6 items-center whitespace-nowrap rounded-full bg-[#5a1a1a] px-2 text-xs font-black text-white"
      title={conflict ? `Резервирана от ${org}. Наш човек вече е тук, пренасочи го.` : `Резервирана от ${org}. Не записваме наши хора тук.`}
      data-testid="reserved-badge"
    >
      ⛔ Резервирана от {org}{conflict ? ' · конфликт' : ''}
    </span>
  )
}

export function reservedOrgFor(code: string, reserved: Record<string, string>) {
  const digits = code.replace(/\D/g, '')
  const key = digits.length === 8 ? `0${digits}` : digits
  return key.length === 9 ? reserved[key] ?? '' : ''
}

let cache: { at: number; value: Promise<Record<string, string>> } | null = null

/** Code → organisation, shared by every row on the page and refreshed after 30 s or on demand. */
export function loadReservedIndex(force = false) {
  if (!cache || force || Date.now() - cache.at > 30_000) {
    cache = {
      at: Date.now(),
      value: adminReservedSections()
        .then((result) => (result.ok ? Object.fromEntries(result.rows.map((row) => [row.sectionCode, row.organisation])) : {}))
        .catch(() => ({})),
    }
  }
  return cache.value
}

export function useReservedIndex(version = 0) {
  const [index, setIndex] = useState<Record<string, string>>({})
  useEffect(() => {
    let live = true
    void loadReservedIndex(version > 0).then((value) => {
      if (live) setIndex(value)
    })
    return () => {
      live = false
    }
  }, [version])
  return index
}
