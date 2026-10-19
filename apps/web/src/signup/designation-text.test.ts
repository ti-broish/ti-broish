import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DESIGNATION_CONFIG,
  REPRESENTATIVE_RIGHTS,
  TODO_PRINCIPAL_EGN,
  TODO_PRINCIPAL_NAME,
  configFromEnv,
  districtLineOf,
  formatBgDate,
  grantorFromEnv,
  mergeDesignationConfig,
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
  principalName: '',
  principalEgn: '',
}

const dummyGrantor = {
  ...grantor,
  name: 'Петър Петров Петров',
  egn: '1111111111',
  principalName: 'Георги Георгиев Георгиев',
  principalEgn: '2222222222',
}

const committee =
  'Инициативен комитет за издигане на кандидатурата на Андрей Атанасов Гюров за президент и Георги Димитров Кандев за вицепрезидент, регистриран за участие в изборите за президент и вицепрезидент на 25 октомври 2026 г. с Решение № 199-ПВР/11.09.2026 г. на ЦИК'

describe('designation text', () => {
  it('uses placeholders when grantor and principal fields are empty', () => {
    const text = designationPlainText(
      buildDesignationBlocks({ number: null, issuedOn: '2026-10-18', grantor, person }, DEFAULT_DESIGNATION_CONFIG),
    )
    expect(text).toContain('[TODO: имена на упълномощителя]')
    expect(text).toContain('[TODO: ЕГН на упълномощителя]')
    expect(text).toContain(TODO_PRINCIPAL_NAME)
    expect(text).toContain(TODO_PRINCIPAL_EGN)
    expect(text).toContain('[TODO: номер]')
    expect(text).toMatch(/^ПРЕУПЪЛНОМОЩАВАМ:$/m)
    expect(text).not.toMatch(/^УПЪЛНОМОЩАВАМ:$/m)
  })

  it('has no TODO placeholders once grantor, principal, number and section are known', () => {
    const text = designationPlainText(
      buildDesignationBlocks({ number: 1, issuedOn: '19.10.2026', grantor: dummyGrantor, person }, DEFAULT_DESIGNATION_CONFIG),
    )
    expect(text).not.toContain('[TODO')
  })

  it('words the opening as in the committee template', () => {
    expect(grantorOpening(dummyGrantor, DEFAULT_DESIGNATION_CONFIG)).toBe(
      `Подписаният Петър Петров Петров, ЕГН 1111111111, в качеството ми на пълномощник на Георги Георгиев Георгиев, ЕГН 2222222222, в качеството му на представляващ самостоятелно ${committee} (ИК).`,
    )
  })

  it('switches the verb and opening with grantor capacity', () => {
    expect(verbForCapacity('пълномощник')).toBe('ПРЕУПЪЛНОМОЩАВАМ')
    expect(verbForCapacity('представляващ')).toBe('УПЪЛНОМОЩАВАМ')
    const representative = { ...dummyGrantor, capacity: 'представляващ' as const, authorisation: 'пълномощно № 1' }
    const text = designationPlainText(
      buildDesignationBlocks({ number: 12, issuedOn: '18.10.2026', grantor: representative, person }, mergeDesignationConfig({ grantorCapacity: 'представляващ' })),
    )
    expect(text).toMatch(/^УПЪЛНОМОЩАВАМ:$/m)
    expect(text).toContain(`в качеството ми на представляващ самостоятелно ${committee} (ИК).`)
    expect(text).not.toContain('Георги Георгиев Георгиев')
    expect(grantorAuthorisationClause(representative)).toBe('')
  })

  it('adds an optional authorisation clause only when set, for a пълномощник', () => {
    expect(grantorAuthorisationClause(grantor)).toBe('')
    const withAuth = { ...dummyGrantor, authorisation: 'упълномощен с пълномощно № 3 от 01.10.2026 г.' }
    expect(grantorAuthorisationClause(withAuth)).toBe(', упълномощен с пълномощно № 3 от 01.10.2026 г')
    expect(grantorOpening(withAuth, DEFAULT_DESIGNATION_CONFIG)).toMatch(/\(ИК\), упълномощен с пълномощно № 3 от 01\.10\.2026 г\.$/)
  })

  it('builds the district line and mandate from the section code', () => {
    expect(districtLineOf('234600001')).toBe('23 изборен район – София-град')
    expect(districtLineOf('320000001')).toBe('32 изборен район – Чужбина')
    expect(districtLineOf('99')).toBe('99 изборен район')
    expect(districtLineOf('')).toBe('[TODO: изборен район]')
    expect(rightsMandateParagraph(person, DEFAULT_DESIGNATION_CONFIG)).toBe(
      `Да бъде ПРЕДСТАВИТЕЛ на ${committee} в 23 изборен район – София-град.`,
    )
  })

  it('formats dates, the number, validity and territory as in the template', () => {
    expect(formatBgDate('2026-10-18')).toBe('18.10.2026')
    expect(formatBgDate('18.10.2026')).toBe('18.10.2026')
    expect(displayedNumber({ number: 4, issuedOn: '', grantor, person }, mergeDesignationConfig({ numberPrefix: 'ИК-' }))).toBe('ИК-4')
    expect(personFullName({ firstName: 'Иван', middleName: '', lastName: 'Иванов' })).toBe('Иван Иванов')
    expect(termParagraph(DEFAULT_DESIGNATION_CONFIG)).toBe(
      'Настоящото пълномощно се издава със срок до 01.11.2026 г. и следва да се тълкува разширително в полза на упълномощеното лице.',
    )
    expect(territoryParagraph(DEFAULT_DESIGNATION_CONFIG)).toBe(
      'Представителят разполага с гореизброените права за всяка от избирателните секции на територията на района, при условие, че носи утвърдения от ЦИК отличителен знак и в съответното изборно помещение не присъства друг упълномощен представител на Инициативния комитет.',
    )
    expect(DEFAULT_DESIGNATION_CONFIG.sealLine).toBe('Инициативният комитет не разполага с печат!')
    expect(sectionInfoLine(person)).toBe('За информация: назначена секция № 234600001, гр. София, район Младост.')
  })

  it('lists the five rights from the template with en-dash bullets', () => {
    expect(REPRESENTATIVE_RIGHTS).toHaveLength(5)
    const text = designationPlainText(buildDesignationBlocks({ number: 1, issuedOn: '18.10.2026', grantor: dummyGrantor, person }, DEFAULT_DESIGNATION_CONFIG))
    expect(text).toContain('– да присъства в изборното помещение при откриването и закриването на изборния ден, по време на гласуването,')
    expect(text).toContain('– да получи срещу подпис, копие от подписания от членовете на СИК протокол')
    expect(text).toContain('– да присъстват на заседанията на избирателните комисии.')
    expect(text).toContain('– да подава жалби и сигнали за нарушения на изборния процес.')
    expect(text).toContain('УПЪЛНОМОЩИТЕЛ:')
    expect(text).toContain('/ Петър Петров Петров /')
    expect(text).toContain('За информация: назначена секция № 234600001')
  })

  it('reads grantor, principal and config from env without inventing values', () => {
    expect(grantorFromEnv({})).toEqual({ name: '', egn: '', capacity: 'пълномощник', authorisation: '', principalName: '', principalEgn: '' })
    expect(grantorFromEnv({ DESIGNATION_PRINCIPAL_NAME: ' Г ', DESIGNATION_PRINCIPAL_EGN: ' 2 ' })).toMatchObject({ principalName: 'Г', principalEgn: '2' })
    expect(configFromEnv({}).validUntil).toBe('01.11.2026')
    expect(configFromEnv({ DESIGNATION_VALID_UNTIL: ' 03.11.2026 ' }).validUntil).toBe('03.11.2026')
    expect(configFromEnv({ DESIGNATION_SECTION_INFO: '0' }).includeSectionInfoLine).toBe(false)
    expect(configFromEnv({ BREVO_DESIGNATION_ATTRIBUTE: 'CUSTOM_URL' }).brevoAttribute).toBe('CUSTOM_URL')
    expect(grantorFromEnv({ DESIGNATION_GRANTOR_CAPACITY: 'представляващ' }).capacity).toBe('представляващ')
  })
})
