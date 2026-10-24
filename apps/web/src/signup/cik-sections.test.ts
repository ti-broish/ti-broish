import { describe, expect, it } from 'vitest'
import { CIK_ABROAD_MACHINE_SECTIONS, CIK_MUNICIPALITIES, CIK_SECTIONS } from './cik-sections.data'
import { parseCikSections, sectionDeskText } from './sections-people-export'

describe('CIK sections fixture (25.10.2026)', () => {
  const sections = parseCikSections(CIK_SECTIONS, CIK_MUNICIPALITIES)

  it('has every domestic section, keyed by МИР code (Пловдив 16/17, София 23/24/25)', () => {
    expect(sections.size).toBe(11777)
    expect([...sections.keys()].every((code) => /^(0[1-9]|[12]\d|3[01])\d{7}$/.test(code))).toBe(true)
    expect(sections.get('010100001')).toMatchObject({ oblast: 'БЛАГОЕВГРАД', municipality: 'БАНСКО', town: 'ГР.БАНСКО', voters: 630 })
    expect(sections.get('170100001')?.municipality).toBe('АСЕНОВГРАД')
    expect(sections.get('162201001')?.municipality).toBe('ПЛОВДИВ')
    const sofia = [...sections.keys()].filter((code) => code.slice(2, 4) === '46' && ['23', '24', '25'].includes(code.slice(0, 2)))
    expect(sofia.length).toBeGreaterThan(1500)
    expect([...sections.keys()].some((code) => code.startsWith('22') && code.slice(2, 4) === '46')).toBe(false)
  })

  it('voters give paper below 300, machine from 300', () => {
    const counted = [...sections.entries()].filter(([, s]) => typeof s.voters === 'number')
    expect(counted.length).toBeGreaterThan(11000)
    const none = new Set<string>()
    for (const [code, section] of counted.slice(0, 500)) {
      expect(sectionDeskText(code, section, undefined, none)).toBe((section.voters ?? 0) < 300 ? 'хартия' : 'машинна')
    }
  })

  it('abroad machine list (CIK р.336) holds only abroad codes', () => {
    const codes = CIK_ABROAD_MACHINE_SECTIONS.split(' ')
    expect(codes.length).toBeGreaterThan(200)
    expect(codes.every((code) => /^32\d{7}$/.test(code))).toBe(true)
  })
})
