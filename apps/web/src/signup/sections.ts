export const PAPER_VOTERS_MAX = 300

export function sectionDesk(section: { votersCount?: number | null; isMachine?: boolean | null }): 'paper' | 'machine' | 'unknown' {
  if (section.isMachine === true) return 'machine'
  const count = section.votersCount
  if (typeof count === 'number' && Number.isFinite(count) && count >= PAPER_VOTERS_MAX) return 'machine'
  if (typeof count === 'number' && Number.isFinite(count) && count >= 0) return 'paper'
  return 'unknown'
}

export function sectionNumber(id: string) {
  return id.length >= 3 ? id.slice(-3) : id
}

export function normalizeAddress(address: string) {
  return address
    .replace(/,([^\s])/g, ', $1')
    .replace(/\.([^\s\d,.])/g, '. $1')
    .replace(/\s+/g, ' ')
    .trim()
}

export function groupSections<T extends { id: string; place: string }>(sections: T[]) {
  const groups = new Map<string, T[]>()
  for (const section of sections) {
    const key = normalizeAddress(section.place).toLocaleLowerCase('bg')
    const list = groups.get(key) ?? []
    list.push(section)
    groups.set(key, list)
  }
  return [...groups.values()].map((list) => ({
    place: normalizeAddress(list[0]?.place ?? ''),
    sections: list,
  }))
}

export function placeSummaries<T extends { id: string; place: string; votersCount?: number | null; isMachine?: boolean | null }>(sections: T[]) {
  return groupSections(sections).map((group) => {
    const paper = group.sections.filter((section) => sectionDesk(section) === 'paper').length
    const machine = group.sections.filter((section) => sectionDesk(section) === 'machine').length
    const unknown = group.sections.length - paper - machine
    return { ...group, paper, machine, unknown }
  })
}

export function addressStats<T extends { id: string; place: string; votersCount?: number | null; isMachine?: boolean | null }>(sections: T[]) {
  return placeSummaries(sections).filter((group) => group.paper > 0)
}

export function spreadAround(center: { lat: number; lng: number }, index: number) {
  const angle = index * 2.399963
  const radius = 0.0032 * Math.sqrt(index + 1)
  return {
    lat: center.lat + Math.sin(angle) * radius,
    lng: center.lng + Math.cos(angle) * radius * 1.35,
  }
}
