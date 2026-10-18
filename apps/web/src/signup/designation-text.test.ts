import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DESIGNATION_CONFIG,
  configFromEnv,
  districtLineOf,
  formatBgDate,
  grantorFromEnv,
  mergeDesignationConfig,
  TODO_GRANTOR_AUTHORISATION,
  verbForCapacity,
} from './designation-config'
import {
  buildDesignationBlocks,
  designationPlainText,
  displayedNumber,
  grantorAuthorisationClause,
  grantorOpening,
  personFullName,
  rightsMandateParagraph,
  sectionInfoLine,
  termParagraph,
  territoryParagraph,
} from './designation-text'

const person = {
  firstName: 'Иван',
  middleName: 'Петров',
  lastName: 'Иванов',
  egn: '0000000000',
  sectionCode: '234600001',
  sectionPlace: 'гр. София, район Младост',
}

const grantor = {
  name: '',
  egn: '',
  capacity: 'пълномощник' as const,
  authorisation: '',
}

describe('designation text', () => {
  it('uses placeholders when grantor fields are empty', () => {
    const text = designationPlainText(
      buildDesignationBlocks({ number: null, issuedOn: '2026-10-18', grantor, person }, DEFAULT_DESIGNATION_CONFIG),
    )
    expect(text).toContain('[TODO: имена на упълномощителя]')
    expect(text).toContain('[TODO: ЕГН на упълномощителя]')
    expect(text).toContain('[TODO: номер]')
    expect(text).toMatch(/^ПРЕУПЪЛНОМОЩАВАМ:$/m)
    expect(text).not.toMatch(/^УПЪЛНОМОЩАВАМ:$/m)
  })

  it('switches the verb with grantor capacity', () => {
    expect(verbForCapacity('пълномощник')).toBe('ПРЕУПЪЛНОМОЩАВАМ')
    expect(verbForCapacity('представляващ')).toBe('УПЪЛНОМОЩАВАМ')
    const text = designationPlainText(
      buildDesignationBlocks(
        {
          number: 12,
          issuedOn: '18.10.2026',
          grantor: { name: 'Мария Иванова', egn: '8001010000', capacity: 'представляващ', authorisation: 'пълномощно № 1 от 01.10.2026 г.' },
          person,
        },
        mergeDesignationConfig({ grantorCapacity: 'представляващ' }),
      ),
    )
    expect(text).toContain('УПЪЛНОМОЩАВАМ:')
    expect(text).toContain('в качеството ми на представляващ')
    expect(grantorAuthorisationClause({ name: 'Мария', egn: '1', capacity: 'представляващ', authorisation: 'пълномощно № 1' })).toBe('')
  })

  it('adds the authorisation clause only for a пълномощник', () => {
    expect(grantorAuthorisationClause({ ...grantor, capacity: 'пълномощник', authorisation: 'упълномощен/а с пълномощно № 3 от 01.10.2026 г.' })).toBe(
      ', упълномощен/а с пълномощно № 3 от 01.10.2026 г.',
    )
    expect(grantorOpening({ ...grantor, name: 'Петър', egn: '8001010000', authorisation: 'упълномощен/а с пълномощно № 3 от 01.10.2026 г.' }, DEFAULT_DESIGNATION_CONFIG)).toContain(
      ', упълномощен/а с пълномощно № 3 от 01.10.2026 г.',
    )
  })

  it('defaults to a пълномощник who sub-delegates, with a visible authorisation TODO', () => {
    const fromEnv = grantorFromEnv({})
    expect(fromEnv.capacity).toBe('пълномощник')
    expect(verbForCapacity(fromEnv.capacity)).toBe('ПРЕУПЪЛНОМОЩАВАМ')
    expect(DEFAULT_DESIGNATION_CONFIG.grantorCapacity).toBe('пълномощник')
    expect(grantorAuthorisationClause(fromEnv)).toBe(`, ${TODO_GRANTOR_AUTHORISATION}.`)
    expect(TODO_GRANTOR_AUTHORISATION).toContain('[TODO: номер]')
    expect(TODO_GRANTOR_AUTHORISATION).toContain('[TODO: дата]')
    expect(grantorOpening({ ...grantor, name: 'Петър', egn: '8001010000' }, DEFAULT_DESIGNATION_CONFIG)).toMatch(
      /насрочени за 25\.10\.2026 г\., упълномощен\/а с пълномощно № \[TODO: номер\] от \[TODO: дата\]/,
    )
  })

  it('builds the district line from the section code', () => {
    expect(districtLineOf('234600001')).toBe('23 изборен район – София-град')
    expect(districtLineOf('320000001')).toBe('32 изборен район – Чужбина')
    expect(districtLineOf('99')).toBe('99 изборен район')
    expect(districtLineOf('')).toBe('[TODO: изборен район]')
    expect(rightsMandateParagraph(person, DEFAULT_DESIGNATION_CONFIG)).toContain('в 23 изборен район – София-град.')
    expect(rightsMandateParagraph(person, DEFAULT_DESIGNATION_CONFIG)).toContain('на 25.10.2026 г., както и при евентуален нов избор на 01.11.2026 г.')
  })

  it('formats dates and the displayed number', () => {
    expect(formatBgDate('2026-10-18')).toBe('18.10.2026')
    expect(formatBgDate('18.10.2026')).toBe('18.10.2026')
    expect(displayedNumber({ number: 4, issuedOn: '', grantor, person }, mergeDesignationConfig({ numberPrefix: 'ИК-' }))).toBe('ИК-4')
    expect(personFullName({ firstName: 'Иван', middleName: '', lastName: 'Иванов' })).toBe('Иван Иванов')
    expect(termParagraph(DEFAULT_DESIGNATION_CONFIG)).toContain('срок до 02.11.2026 г.')
    expect(territoryParagraph(DEFAULT_DESIGNATION_CONFIG)).toContain('Решение № 61-ПВР от 28 август 2026 г.')
    expect(sectionInfoLine(person)).toBe('За информация: назначена секция № 234600001, гр. София, район Младост.')
  })

  it('renders singular rights and the committee short name', () => {
    const text = designationPlainText(buildDesignationBlocks({ number: 1, issuedOn: '18.10.2026', grantor: { ...grantor, name: 'А', egn: '1' }, person }, DEFAULT_DESIGNATION_CONFIG))
    expect(text).toContain('а) да присъства в изборното помещение при откриването и закриването на изборния ден;')
    expect(text).toContain('д) да получи срещу подпис')
    expect(text).toContain('е) да подава жалби')
    expect(text).toContain('му се осигурява пряка видимост')
    expect(text).toContain('Инициативния комитет')
    expect(text).toContain('УПЪЛНОМОЩИТЕЛ:')
    expect(text).toContain('За информация: назначена секция № 234600001')
  })

  it('reads grantor and config from env without inventing values', () => {
    expect(grantorFromEnv({})).toEqual({ name: '', egn: '', capacity: 'пълномощник', authorisation: '' })
    expect(configFromEnv({}).validUntil).toBe('02.11.2026')
    expect(configFromEnv({ DESIGNATION_VALID_UNTIL: ' 03.11.2026 ' }).validUntil).toBe('03.11.2026')
    expect(configFromEnv({ DESIGNATION_SECTION_INFO: '0' }).includeSectionInfoLine).toBe(false)
    expect(configFromEnv({ BREVO_DESIGNATION_ATTRIBUTE: 'CUSTOM_URL' }).brevoAttribute).toBe('CUSTOM_URL')
    expect(grantorFromEnv({ DESIGNATION_GRANTOR_CAPACITY: 'представляващ' }).capacity).toBe('представляващ')
  })
})
