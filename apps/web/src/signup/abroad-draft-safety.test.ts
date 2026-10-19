import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { distributeAbroad } from './abroad-distribute'
import { parsePeopleCsv } from './admin-csv'

const here = dirname(fileURLToPath(import.meta.url))

function source(name: string) {
  return readFileSync(join(here, name), 'utf8')
}

describe('abroad draft safety — no mail / Brevo on draft save', () => {
  it('adminDraft only updates draft_section and never imports mail or Brevo', () => {
    const text = source('admin-assign-actions.ts')
    expect(text).toContain("SET draft_section = NULLIF(?, '')")
    expect(text.includes("from './mail'") || text.includes('from "./mail"')).toBe(false)
    expect(text.includes("from './brevo") || text.includes('from "./brevo')).toBe(false)
    expect(text).not.toContain('deliverMail')
    expect(text).not.toContain('assignmentMail')
    const draftHandler = text.slice(text.indexOf('export const adminDraft'), text.indexOf('export const adminPublish'))
    expect(draftHandler).toContain('draft_section')
    expect(draftHandler).not.toContain('published_section')
    expect(draftHandler).not.toContain('deliverMail')
  })

  it('abroad save-drafts only writes draft_section and never touches mail/Brevo/publish', () => {
    const text = source('abroad-distribute-admin.ts')
    expect(text).toContain('SET draft_section = ?, draft_locked = 0')
    expect(text.includes("from './mail'") || text.includes('from "./mail"')).toBe(false)
    expect(text.includes("from './brevo") || text.includes('from "./brevo')).toBe(false)
    expect(text).not.toContain('deliverMail')
    expect(text).not.toContain('assignmentMail')
    expect(text).not.toContain('published_section =')
    const saveHandler = text.slice(text.indexOf('export const adminSaveAbroadDrafts'), text.indexOf('async function buildPlan'))
    expect(saveHandler).toContain('draft_section')
    expect(saveHandler).not.toContain('published_section =')
    expect(saveHandler).not.toContain('deliverMail')
  })

  it('people import handler only sends importConfirmMail, never assignmentMail', () => {
    const text = source('admin.ts')
    const importFn = text.slice(text.indexOf('export const adminImportPeople'), text.indexOf('export const adminResendImports'))
    expect(importFn).toContain('importConfirmMail')
    expect(importFn).toContain('deliverMail(importConfirmMail')
    expect(importFn).not.toContain('assignmentMail')
    expect(importFn).not.toContain('published_section')
    const importPersonFn = text.slice(text.indexOf('async function importPerson'), text.indexOf('function columnsFor'))
    expect(importPersonFn).toContain('draft_section')
    expect(importPersonFn).not.toContain('published_section')
    expect(importPersonFn).not.toContain('deliverMail')
  })

  it('people CSV with a section stays draft-shaped in the parse result (no publish fields)', () => {
    const parsed = parsePeopleCsv(
      'имейл,държава,град,секция\nvol@example.com,Австрия,Виена,320021001\n',
    )
    expect(parsed.errors).toEqual([])
    expect(parsed.rows[0]?.section).toBe('320021001')
    expect(parsed.rows[0]).not.toHaveProperty('publishedSection')
  })

  it('distributeAbroad returns draft assignments only (no publish/mail side effects in planner)', () => {
    const plan = distributeAbroad({
      people: [
        {
          id: '1',
          email: 'a@example.com',
          role: 'section',
          mobileTeam: false,
          regionCode: '32',
          mir: '32',
          countryName: 'Австрия',
          cityName: 'Виена',
        },
      ],
      sections: [
        {
          id: '320021001',
          country: 'Австрия',
          city: 'Виена',
          placeLabel: 'Виена',
          tierLetter: 'C',
          capacity: 1,
        },
      ],
    })
    expect(plan.assignments).toEqual([
      {
        personId: '1',
        email: 'a@example.com',
        sectionId: '320021001',
        country: 'Австрия',
        city: 'Виена',
        tierLetter: 'C',
      },
    ])
    expect(plan).not.toHaveProperty('published')
    expect(plan).not.toHaveProperty('mailed')
  })
})
