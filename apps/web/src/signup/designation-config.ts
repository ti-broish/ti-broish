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
 *   and Константин Петров Вълков. Grantor and principal names/EGN come only from env.
 * - Wording of the пълномощно: the committee's own template (Oct 2026).
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
  /** „регистриран за участие в … с Решение … на ЦИК“, as worded in the committee's template. */
  committeeRegistration: string
  /** Seal line from the committee's template (the committee has no seal). */
  sealLine: string
  validUntil: string
  numberPrefix: string
  grantorCapacity: GrantorCapacity
  brevoAttribute: string
}

/** Brevo contact attribute that holds the signed пълномощно Drive link. Override with BREVO_DESIGNATION_ATTRIBUTE. */
export const DEFAULT_BREVO_DESIGNATION_ATTRIBUTE = 'DOCUMENT_URL'

export const DEFAULT_DESIGNATION_CONFIG: DesignationConfig = {
  committeeFullName:
    'Инициативен комитет за издигане на кандидатурата на Андрей Атанасов Гюров за президент и Георги Димитров Кандев за вицепрезидент',
  committeeShortName: 'Инициативния комитет',
  committeeFoundedOn: '10.09.2026',
  committeeDecision: 'Решение № 199-ПВР от 11 септември 2026 г. на ЦИК',
  electionName: 'изборите за президент и вицепрезидент на републиката',
  electionDate: '25.10.2026',
  runoffDate: '01.11.2026',
  runoffLegalRef: 'т. 24 от Решение № 339-ПВР от 12 октомври 2026 г. на ЦИК',
  distinctiveSignDecision: 'Решение № 61-ПВР от 28 август 2026 г. на ЦИК',
  representativesDecision: 'Решение № 339-ПВР от 12 октомври 2026 г. на ЦИК',
  committeeRegistration:
    'регистриран за участие в изборите за президент и вицепрезидент на 25 октомври 2026 г. с Решение № 199-ПВР/11.09.2026 г. на ЦИК',
  sealLine: 'Инициативният комитет не разполага с печат!',
  validUntil: '01.11.2026',
  numberPrefix: '',
  grantorCapacity: 'пълномощник',
  brevoAttribute: DEFAULT_BREVO_DESIGNATION_ATTRIBUTE,
}

/** МИР 32: the пълномощно names it exactly like this, with no „32 изборен район“. */
export const ABROAD_DISTRICT = 'Извън страната'

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
  '32': ABROAD_DISTRICT,
}

/**
 * Rights exactly as worded in the committee's пълномощно template (Oct 2026),
 * listed under "Представителят има право:" (markers and indents: RIGHTS_LAYOUT).
 */
export const REPRESENTATIVE_RIGHTS = [
  'да присъства в изборното помещение при откриването и закриването на изборния ден, по време на гласуването, както и при отварянето на избирателните кутии и при установяване на резултатите от гласуването, като му се осигури пряка видимост, включително чрез видеозаснемане или видеоизлъчване по ред, определен от Централната избирателна комисия;',
  'да присъства при въвеждането в районната избирателна комисия на данните от протоколите на СИК с резултатите от гласуването в избирателните секции и при приемане и проверка на протоколите на СИК, като му се осигурява пряка видимост при приемането и проверката на протоколите, включително чрез видеозаснемане или видеоизлъчване по ред, определен от Централната избирателна комисия;',
  'да получи срещу подпис, копие от подписания от членовете на СИК протокол с резултатите от гласуването в избирателната секция, подпечатано на всяка страница с печата на комисията и подписано от председателя, заместник-председателя и секретаря;',
  'да присъстват на заседанията на избирателните комисии.',
  'да подава жалби и сигнали за нарушения на изборния процес.',
] as const


export const TODO_GRANTOR_NAME = '[TODO: имена на упълномощителя]'
export const TODO_GRANTOR_EGN = '[TODO: ЕГН на упълномощителя]'
export const TODO_PERSON_EGN = '[TODO: ЕГН]'
export const TODO_PERSON_NAME = '[TODO: имена]'
export const TODO_NUMBER = '[TODO: номер]'
export const TODO_PRINCIPAL_NAME = '[TODO: имена на представляващия Инициативния комитет]'
export const TODO_PRINCIPAL_EGN = '[TODO: ЕГН на представляващия Инициативния комитет]'
export const TODO_DISTRICT = '[TODO: изборен район]'

export interface DesignationGrantorFields {
  name: string
  egn: string
  capacity: GrantorCapacity
  /**
   * Optional extra clause about the grantor's own authorisation, e.g.
   * "упълномощен с пълномощно № 1 от 15.10.2026 г.". The current template has none.
   */
  authorisation: string
  /** Who the grantor is пълномощник of: the committee's representative (секретно — names + ЕГН). */
  principalName: string
  principalEgn: string
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
    principalName: (env.DESIGNATION_PRINCIPAL_NAME ?? '').trim(),
    principalEgn: (env.DESIGNATION_PRINCIPAL_EGN ?? '').trim(),
  }
}

export function configFromEnv(env: Record<string, string | undefined>): DesignationConfig {
  const overrides: Partial<DesignationConfig> = {}
  if (env.DESIGNATION_NUMBER_PREFIX?.trim()) overrides.numberPrefix = env.DESIGNATION_NUMBER_PREFIX.trim()
  if (env.DESIGNATION_VALID_UNTIL?.trim()) overrides.validUntil = env.DESIGNATION_VALID_UNTIL.trim()
  if (env.DESIGNATION_SEAL_LINE?.trim()) overrides.sealLine = env.DESIGNATION_SEAL_LINE.trim()
  if (env.DESIGNATION_GRANTOR_CAPACITY?.trim() === 'представляващ') overrides.grantorCapacity = 'представляващ'
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
  if (nn === '32') return ABROAD_DISTRICT
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

