import { mirFromSection, normalizeSection } from './admin-csv'
import { sectionDesk } from './sections'

export type AssignWarningCode = 'taken' | 'duplicate' | 'mir_mismatch'

export interface AssignWarning {
  code: AssignWarningCode
  /** `block` stops publish; draft save still keeps the value but surfaces the message. */
  level: 'warn' | 'block'
  message: string
}

export interface DuplicateOwner {
  id: string
  email: string
  kind: 'draft' | 'published'
}

export interface SectionCandidate {
  id: string
  place: string
  score: number
  reason: string
  desk: 'paper' | 'machine' | 'unknown'
}

export interface SuggestPerson {
  mir: string
  town: string
  municipality: string
  place: string
  radius: string
  travelMunicipalities: string
}

export function validateAssignment(input: {
  section: string
  personId: string
  personMir: string
  takenOrg: string | null
  duplicate: DuplicateOwner | null
}): AssignWarning[] {
  const section = normalizeSection(input.section)
  if (!section) return []

  const warnings: AssignWarning[] = []

  if (input.takenOrg) {
    warnings.push({
      code: 'taken',
      level: 'block',
      message: `Секцията е заета от ${input.takenOrg}.`,
    })
  }

  if (input.duplicate && input.duplicate.id !== input.personId) {
    const where = input.duplicate.kind === 'published' ? 'публикувана' : 'в чернова'
    warnings.push({
      code: 'duplicate',
      level: 'block',
      message: `Секцията вече е ${where} при ${input.duplicate.email}.`,
    })
  }

  const sectionMir = mirFromSection(section)
  const personMir = padMir(input.personMir)
  if (sectionMir && personMir && sectionMir !== personMir) {
    warnings.push({
      code: 'mir_mismatch',
      level: 'block',
      message: `МИР на секцията е ${sectionMir}, а човекът е в МИР ${personMir}.`,
    })
  }

  return warnings
}

/** Publish is blocked when any warning has level `block` (taken, duplicate, MIR mismatch). */
export function publishBlocked(warnings: AssignWarning[]) {
  return warnings.some((warning) => warning.level === 'block')
}

export function warningSummary(warnings: AssignWarning[]) {
  return warnings.map((warning) => warning.message).join(' ')
}

export function scoreSectionSuggestions(
  sections: Array<{ id: string; place: string; votersCount?: number | null; isMachine?: boolean | null }>,
  person: SuggestPerson,
  blocked: Set<string>,
  limit = 8,
): SectionCandidate[] {
  const personMir = padMir(person.mir)
  const placeNorm = fold(person.place)
  const townNorm = fold(person.town)
  const municipalityNorm = fold(person.municipality)
  const travelNames = travelNamesOf(person.travelMunicipalities).map(fold).filter(Boolean)

  const scored: SectionCandidate[] = []
  for (const section of sections) {
    const id = normalizeSection(section.id)
    if (!id || blocked.has(id)) continue

    const sectionMir = mirFromSection(id)
    if (personMir && sectionMir && sectionMir !== personMir) continue

    let score = 10
    const reasons: string[] = ['свободна']

    if (personMir && sectionMir === personMir) {
      score += 40
      reasons.push('МИР')
    }

    const sectionPlace = fold(section.place)
    if (placeNorm && sectionPlace.includes(placeNorm)) {
      score += 35
      reasons.push('място')
    } else if (placeNorm && tokens(placeNorm).some((token) => token.length > 3 && sectionPlace.includes(token))) {
      score += 18
      reasons.push('близко място')
    }

    if (townNorm && sectionPlace.includes(townNorm)) {
      score += 12
      reasons.push('град')
    }

    if (municipalityNorm && sectionPlace.includes(municipalityNorm)) {
      score += 8
      reasons.push('община')
    }

    if (person.radius) {
      score += 2
      reasons.push(`радиус ${person.radius}`)
    }

    if (travelNames.some((name) => name && sectionPlace.includes(name))) {
      score += 15
      reasons.push('пътуване')
    }

    const desk = sectionDesk(section)
    if (desk === 'paper') reasons.push('хартиена')
    else if (desk === 'machine') reasons.push('машинна')

    scored.push({
      id,
      place: section.place,
      score,
      reason: [...new Set(reasons)].join(' · '),
      desk,
    })
  }

  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
  return scored.slice(0, limit)
}

function padMir(value: string) {
  const trimmed = value.trim()
  if (!/^\d{1,2}$/.test(trimmed)) return ''
  return trimmed.padStart(2, '0')
}

function fold(value: string) {
  return value
    .trim()
    .toLocaleLowerCase('bg')
    .replace(/^гр\.?\s*/i, '')
    .replace(/^с\.?\s*/i, '')
    .replace(/\s+/g, ' ')
}

function tokens(value: string) {
  return value.split(/[\s,./\-]+/).filter(Boolean)
}

export function travelLabelOf(raw: string) {
  return travelNamesOf(raw).slice(0, 3).join(', ')
}

function travelNamesOf(raw: string) {
  if (!raw) return [] as string[]
  try {
    const parsed = JSON.parse(raw) as Array<{ name?: string }>
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => item.name ?? '').filter(Boolean)
  } catch {
    return []
  }
}
