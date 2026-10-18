/**
 * Verified election and committee constants for the representative power of attorney.
 * Personal grantor fields stay out of this file — they come from env/CLI.
 *
 * Sources:
 * - Election date 25.10.2026 and runoff 01.11.2026 (Constitution art. 93(4)):
 *   https://www.parliament.bg/bg/laws/ID/167493
 *   https://www.parliament.bg/bg/news/ID/6600
 * - Committee registration, Решение № 199-ПВР от 11 септември 2026 г.:
 *   https://www.cik.bg/bg/decisions/199/2026-09-11
 *   Public representatives (each independently): Александрина Иванова Пендачанска
 *   and Константин Петров Вълков. Grantor name/EGN still come only from env.
 * - Representatives (пълномощно contents, rights, runoff validity), Решение № 339-ПВР от 12 октомври 2026 г.
 * - Distinctive sign, Решение № 61-ПВР от 28 август 2026 г.
 */

export type GrantorCapacity = 'пълномощник' | 'представляващ'

export interface DesignationConfig {
  committeeFullName: string
  committeeShortName: string
  committeeFoundedOn: string
  committeeDecision: string
  electionName: string
  electionDate: string
  runoffDate: string
  runoffLegalRef: string
  distinctiveSignDecision: string
  representativesDecision: string
  /** TODO: confirm with the committee that it has no seal. */
  sealLine: string
  validUntil: string
  numberPrefix: string
  grantorCapacity: GrantorCapacity
  includeSectionInfoLine: boolean
  brevoAttribute: string
}

export const DEFAULT_DESIGNATION_CONFIG: DesignationConfig = {
  committeeFullName:
    'Инициативен комитет за издигане на Андрей Атанасов Гюров за независим кандидат за президент и Георги Димитров Кандев за независим кандидат за вицепрезидент на републиката',
  committeeShortName: 'Инициативния комитет',
  committeeFoundedOn: '10.09.2026',
  committeeDecision: 'Решение № 199-ПВР от 11 септември 2026 г. на ЦИК',
  electionName: 'изборите за президент и вицепрезидент на републиката',
  electionDate: '25.10.2026',
  runoffDate: '01.11.2026',
  runoffLegalRef: 'т. 24 от Решение № 339-ПВР от 12 октомври 2026 г. на ЦИК',
  distinctiveSignDecision: 'Решение № 61-ПВР от 28 август 2026 г. на ЦИК',
  representativesDecision: 'Решение № 339-ПВР от 12 октомври 2026 г. на ЦИК',
  sealLine: 'Инициативният комитет не разполага с печат!',
  validUntil: '02.11.2026',
  numberPrefix: '',
  grantorCapacity: 'пълномощник',
  includeSectionInfoLine: true,
  brevoAttribute: 'PALNOMOSHTNO_URL',
}

/** МИР / изборен район from the first two digits of a 9-digit section code. */
export const ELECTION_DISTRICTS: Record<string, string> = {
  '01': 'Благоевград',
  '02': 'Бургас',
  '03': 'Варна',
  '04': 'Велико Търново',
  '05': 'Видин',
  '06': 'Враца',
  '07': 'Габрово',
  '08': 'Добрич',
  '09': 'Кърджали',
  '10': 'Кюстендил',
  '11': 'Ловеч',
  '12': 'Монтана',
  '13': 'Пазарджик',
  '14': 'Перник',
  '15': 'Плевен',
  '16': 'Пловдив',
  '17': 'Пловдив',
  '18': 'Разград',
  '19': 'Русе',
  '20': 'Силистра',
  '21': 'Сливен',
  '22': 'Смолян',
  '23': 'София-град',
  '24': 'София-град',
  '25': 'София-град',
  '26': 'София',
  '27': 'Стара Загора',
  '28': 'Търговище',
  '29': 'Хасково',
  '30': 'Шумен',
  '31': 'Ямбол',
  '32': 'Чужбина',
}

/**
 * Rights from т. 13 of Решение № 339-ПВР, rendered in the singular to match
 * "Представителят има право:".
 */
export const REPRESENTATIVE_RIGHTS = [
  'да присъства в изборното помещение при откриването и закриването на изборния ден;',
  'да присъства в изборното помещение по време на гласуването;',
  'да присъства в изборното помещение при отварянето на избирателните кутии и при установяване на резултатите от гласуването, за което му се осигурява пряка видимост;',
  'да присъства при въвеждането и повторното въвеждане в избирателните комисии и в изчислителните пунктове на данните от протоколите с резултатите от гласуването на секционните избирателни комисии;',
  'да получи срещу подпис копие от протокола с резултатите от гласуването в избирателната секция, включително протокола с данните от машинното гласуване и протокола от контролното преброяване на контролните разписки, както и с резултатите от гласуването в съответния район;',
  'да подава жалби и сигнали за нарушения на изборния процес.',
] as const

export const RIGHTS_LETTERS = ['а', 'б', 'в', 'г', 'д', 'е'] as const

export const TODO_GRANTOR_NAME = '[TODO: имена на упълномощителя]'
export const TODO_GRANTOR_EGN = '[TODO: ЕГН на упълномощителя]'
export const TODO_PERSON_EGN = '[TODO: ЕГН]'
export const TODO_PERSON_NAME = '[TODO: имена]'
export const TODO_NUMBER = '[TODO: номер]'
/**
 * Shown while the grantor's own authorisation from the committee is unknown.
 * Replace by setting DESIGNATION_GRANTOR_AUTHORISATION to the whole clause.
 */
export const TODO_GRANTOR_AUTHORISATION =
  'упълномощен/а с пълномощно № [TODO: номер] от [TODO: дата] от [TODO: представляващ Инициативния комитет – Александрина Иванова Пендачанска или Константин Петров Вълков]'
export const TODO_DISTRICT = '[TODO: изборен район]'

export interface DesignationGrantorFields {
  name: string
  egn: string
  capacity: GrantorCapacity
  authorisation: string
}

export function mergeDesignationConfig(overrides: Partial<DesignationConfig> = {}): DesignationConfig {
  const next = { ...DEFAULT_DESIGNATION_CONFIG }
  for (const key of Object.keys(overrides) as Array<keyof DesignationConfig>) {
    const value = overrides[key]
    if (value !== undefined) (next[key] as DesignationConfig[typeof key]) = value
  }
  return next
}

export function grantorFromEnv(env: Record<string, string | undefined>): DesignationGrantorFields {
  return {
    name: (env.DESIGNATION_GRANTOR_NAME ?? '').trim(),
    egn: (env.DESIGNATION_GRANTOR_EGN ?? '').trim(),
    capacity: env.DESIGNATION_GRANTOR_CAPACITY?.trim() === 'представляващ' ? 'представляващ' : 'пълномощник',
    authorisation: (env.DESIGNATION_GRANTOR_AUTHORISATION ?? '').trim(),
  }
}

export function configFromEnv(env: Record<string, string | undefined>): DesignationConfig {
  const overrides: Partial<DesignationConfig> = {}
  if (env.DESIGNATION_NUMBER_PREFIX?.trim()) overrides.numberPrefix = env.DESIGNATION_NUMBER_PREFIX.trim()
  if (env.DESIGNATION_VALID_UNTIL?.trim()) overrides.validUntil = env.DESIGNATION_VALID_UNTIL.trim()
  if (env.DESIGNATION_SEAL_LINE?.trim()) overrides.sealLine = env.DESIGNATION_SEAL_LINE.trim()
  if (env.DESIGNATION_GRANTOR_CAPACITY?.trim() === 'представляващ') overrides.grantorCapacity = 'представляващ'
  if (env.DESIGNATION_SECTION_INFO === '0') overrides.includeSectionInfoLine = false
  if (env.BREVO_DESIGNATION_ATTRIBUTE?.trim()) overrides.brevoAttribute = env.BREVO_DESIGNATION_ATTRIBUTE.trim()
  return mergeDesignationConfig(overrides)
}

export function verbForCapacity(capacity: GrantorCapacity) {
  return capacity === 'представляващ' ? 'УПЪЛНОМОЩАВАМ' : 'ПРЕУПЪЛНОМОЩАВАМ'
}

export function districtLineOf(sectionCode: string, districts: Record<string, string> = ELECTION_DISTRICTS) {
  const digits = sectionCode.replace(/\D/g, '')
  if (digits.length < 2) return TODO_DISTRICT
  const nn = digits.slice(0, 2)
  const name = districts[nn]
  return name ? `${nn} изборен район – ${name}` : `${nn} изборен район`
}

export function formatBgDate(value: string) {
  const trimmed = value.trim()
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(trimmed)) return trimmed
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed)
  if (iso) return `${iso[3]}.${iso[2]}.${iso[1]}`
  return trimmed
}

export function todayInSofia(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Sofia',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(now)
  const day = parts.find((part) => part.type === 'day')?.value ?? '01'
  const month = parts.find((part) => part.type === 'month')?.value ?? '01'
  const year = parts.find((part) => part.type === 'year')?.value ?? '2026'
  return `${day}.${month}.${year}`
}

export function formatDesignationNumber(n: number, prefix: string) {
  return `${prefix}${n}`
}

export function designationPdfFilename(number: string, fullName: string) {
  const name = fullName.replace(/[/\\?%*:|"<>]/g, ' ').replace(/\s+/g, ' ').trim() || 'без-име'
  return `Пълномощно ${number} – ${name}.pdf`
}
