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
  RIGHTS_LAYOUT,
  buildDesignationBlocks,
  designationPlainText,
  displayedNumber,
  grantorAuthorisationClause,
  grantorOpening,
  numberLine,
  personFullName,
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

/**
 * The committee's template („[Шаблон] … .docx“, Oct 2026), paragraph by paragraph,
 * with its placeholders filled by dummy data. Only <<Номер с дата>>, <<Имена>>,
 * <<ЕГН>>, <<МИР Име>> and the signer data differ from the template.
 */
const TEMPLATE_WITH_DUMMY_DATA = [
  'П Ъ Л Н О М О Щ Н О №   501/19.10.2026',
  'Подписаният Петър Петров Петров, ЕГН 1111111111, в качеството ми на пълномощник на Георги Георгиев Георгиев, ЕГН 2222222222, в качеството му на представляващ самостоятелно Инициативен комитет за издигане на кандидатурата на Андрей Атанасов Гюров за президент и Георги Димитров Кандев за вицепрезидент, регистриран за участие в изборите за президент и вицепрезидент на 25 октомври 2026 г. с Решение № 199-ПВР/11.09.2026 г. на ЦИК (ИК)',
  'ПРЕУПЪЛНОМОЩАВАМ:',
  'Иван Петров Иванов, ЕГН  0000000000',
  '',
  'СЪС СЛЕДНИТЕ ПРАВА:',
  'Да бъде ПРЕДСТАВИТЕЛ на Инициативен комитет за издигане на кандидатурата на Андрей Атанасов Гюров за президент и Георги Димитров Кандев за вицепрезидент, регистриран за участие в изборите за президент и вицепрезидент на 25 октомври 2026 г. с Решение № 199-ПВР/11.09.2026 г. на ЦИК в 23 изборен район – София-град.',
  'Представителят има право:',
  '– да присъства в изборното помещение при откриването и закриването на изборния ден, по време на гласуването, както и при отварянето на избирателните кутии и при установяване на резултатите от гласуването, като му се осигури пряка видимост, включително чрез видеозаснемане или видеоизлъчване по ред, определен от Централната избирателна комисия;',
  '- да присъства при въвеждането в районната избирателна комисия на данните от протоколите на СИК с резултатите от гласуването в избирателните секции и при приемане и проверка на протоколите на СИК, като му се осигурява пряка видимост при приемането и проверката на протоколите, включително чрез видеозаснемане или видеоизлъчване по ред, определен от Централната избирателна комисия;',
  '– да получи срещу подпис, копие от подписания от членовете на СИК протокол с резултатите от гласуването в избирателната секция, подпечатано на всяка страница с печата на комисията и подписано от председателя, заместник-председателя и секретаря;',
  '- да присъстват на заседанията на избирателните комисии.',
  '– да подава жалби и сигнали за нарушения на изборния процес.',
  'Представителят разполага с гореизброените права за всяка от избирателните секции на територията на района, при условие, че носи утвърдения от ЦИК отличителен знак и в съответното изборно помещение не присъства друг упълномощен представител на Инициативния комитет.',
  'Настоящото пълномощно се издава със срок до 01.11.2026 г. и следва да се тълкува разширително в полза на упълномощеното лице.',
  'Инициативният комитет не разполага с печат!',
  '',
  'УПЪЛНОМОЩИТЕЛ:',
].join('\n')

describe('designation text', () => {
  it('matches the committee template word for word, placeholders aside', () => {
    const text = designationPlainText(
      buildDesignationBlocks({ number: 501, issuedOn: '19.10.2026', grantor: dummyGrantor, person }, DEFAULT_DESIGNATION_CONFIG),
    )
    expect(text).toBe(TEMPLATE_WITH_DUMMY_DATA)
  })

  it('ends on the template „УПЪЛНОМОЩИТЕЛ:“ with no signature line, name or section footer', () => {
    const text = designationPlainText(
      buildDesignationBlocks({ number: 501, issuedOn: '19.10.2026', grantor: dummyGrantor, person }, DEFAULT_DESIGNATION_CONFIG),
    )
    expect(text.match(/УПЪЛНОМОЩИТЕЛ:/g)).toHaveLength(1)
    expect(text.endsWith('Инициативният комитет не разполага с печат!\n\nУПЪЛНОМОЩИТЕЛ:')).toBe(true)
    expect(text).not.toContain('За информация')
    expect(text).not.toContain('....')
    expect(text).not.toContain('Петър Петров Петров /')
  })

  it('renders the number line as „№   501/19.10.2026“', () => {
    expect(numberLine({ number: 501, issuedOn: '19.10.2026', grantor, person }, DEFAULT_DESIGNATION_CONFIG)).toBe('№   501/19.10.2026')
    expect(numberLine({ number: 502, issuedOn: '2026-10-20', grantor, person }, DEFAULT_DESIGNATION_CONFIG)).toBe('№   502/20.10.2026')
    expect(numberLine({ number: null, issuedOn: '19.10.2026', grantor, person }, DEFAULT_DESIGNATION_CONFIG)).toBe('№   [TODO: номер]/19.10.2026')
  })

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
  })

  it('switches the verb and opening with grantor capacity', () => {
    expect(verbForCapacity('пълномощник')).toBe('ПРЕУПЪЛНОМОЩАВАМ')
    expect(verbForCapacity('представляващ')).toBe('УПЪЛНОМОЩАВАМ')
    const representative = { ...dummyGrantor, capacity: 'представляващ' as const, authorisation: 'пълномощно № 1' }
    const text = designationPlainText(
      buildDesignationBlocks({ number: 512, issuedOn: '18.10.2026', grantor: representative, person }, mergeDesignationConfig({ grantorCapacity: 'представляващ' })),
    )
    expect(text).toMatch(/^УПЪЛНОМОЩАВАМ:$/m)
    expect(text).toMatch(/в качеството ми на представляващ самостоятелно .* \(ИК\)$/m)
    expect(text).not.toContain('Георги Георгиев Георгиев')
    expect(grantorAuthorisationClause(representative)).toBe('')
  })

  it('adds an optional authorisation clause only when set, still with no full stop', () => {
    expect(grantorAuthorisationClause(grantor)).toBe('')
    const withAuth = { ...dummyGrantor, authorisation: 'упълномощен с пълномощно № 3 от 01.10.2026 г.' }
    expect(grantorOpening(withAuth, DEFAULT_DESIGNATION_CONFIG)).toMatch(/\(ИК\), упълномощен с пълномощно № 3 от 01\.10\.2026 г$/)
    expect(grantorOpening(dummyGrantor, DEFAULT_DESIGNATION_CONFIG).endsWith('(ИК)')).toBe(true)
  })

  it('keeps the template list markers and indents', () => {
    expect(REPRESENTATIVE_RIGHTS).toHaveLength(5)
    expect(RIGHTS_LAYOUT.map((item) => item.marker)).toEqual(['–', '-', '–', '-', '–'])
    // Positions as in the reference PDF: text 36 pt after the marker for items 1–3, hanging indents for 4–5.
    expect(RIGHTS_LAYOUT.map((item) => item.textAt)).toEqual([37.5, 37.5, 37.5, 8.25, 10.5])
    expect(RIGHTS_LAYOUT.map((item) => item.wrapAt)).toEqual([1.5, 1.5, 1.5, 8.25, 10.5])
    expect(RIGHTS_LAYOUT.map((item) => item.indentRight)).toEqual([1.8, 1.8, 1.75, 0, 0])
  })

  it('builds the district line from the section code', () => {
    expect(districtLineOf('234600001')).toBe('23 изборен район – София-град')
    expect(districtLineOf('320000001')).toBe('32 изборен район – Чужбина')
    expect(districtLineOf('')).toBe('[TODO: изборен район]')
  })

  it('formats dates and names', () => {
    expect(formatBgDate('2026-10-18')).toBe('18.10.2026')
    expect(displayedNumber({ number: 504, issuedOn: '', grantor, person }, DEFAULT_DESIGNATION_CONFIG)).toBe('504')
    expect(personFullName({ firstName: 'Иван', middleName: '', lastName: 'Иванов' })).toBe('Иван Иванов')
  })

  it('reads grantor, principal and config from env without inventing values', () => {
    expect(grantorFromEnv({})).toEqual({ name: '', egn: '', capacity: 'пълномощник', authorisation: '', principalName: '', principalEgn: '' })
    expect(grantorFromEnv({ DESIGNATION_PRINCIPAL_NAME: ' Г ', DESIGNATION_PRINCIPAL_EGN: ' 2 ' })).toMatchObject({ principalName: 'Г', principalEgn: '2' })
    expect(configFromEnv({}).validUntil).toBe('01.11.2026')
    expect(configFromEnv({ DESIGNATION_VALID_UNTIL: ' 03.11.2026 ' }).validUntil).toBe('03.11.2026')
    expect(configFromEnv({ BREVO_DESIGNATION_ATTRIBUTE: 'CUSTOM_URL' }).brevoAttribute).toBe('CUSTOM_URL')
    expect(grantorFromEnv({ DESIGNATION_GRANTOR_CAPACITY: 'представляващ' }).capacity).toBe('представляващ')
  })
})
