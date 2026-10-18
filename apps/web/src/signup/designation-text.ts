import {
  RIGHTS_LETTERS,
  REPRESENTATIVE_RIGHTS,
  TODO_GRANTOR_AUTHORISATION,
  TODO_GRANTOR_EGN,
  TODO_GRANTOR_NAME,
  TODO_NUMBER,
  TODO_PERSON_EGN,
  TODO_PERSON_NAME,
  districtLineOf,
  formatBgDate,
  formatDesignationNumber,
  verbForCapacity,
  type DesignationConfig,
  type DesignationGrantorFields,
} from './designation-config'

export type DesignationGrantor = DesignationGrantorFields

export interface DesignationPersonInput {
  firstName: string
  middleName: string
  lastName: string
  egn: string
  sectionCode: string
  sectionPlace: string
}

export interface DesignationRenderInput {
  number: string | number | null
  issuedOn: string
  grantor: DesignationGrantor
  person: DesignationPersonInput
}

export type TextRun = { text: string; bold?: boolean }

export type DesignationBlock =
  | { type: 'title'; text: string }
  | { type: 'center'; text: string; bold?: boolean }
  | { type: 'paragraph'; runs: TextRun[]; firstLineIndent?: boolean }
  | { type: 'left'; runs: TextRun[] }
  | { type: 'bullets'; items: string[] }
  | { type: 'spacer' }
  | { type: 'signature'; grantorName: string }
  | { type: 'info'; text: string }

export function personFullName(person: Pick<DesignationPersonInput, 'firstName' | 'middleName' | 'lastName'>) {
  const name = [person.firstName, person.middleName, person.lastName].map((part) => part.trim()).filter(Boolean).join(' ')
  return name || TODO_PERSON_NAME
}

export function visibleOrTodo(value: string, todo: string) {
  const trimmed = value.trim()
  return trimmed || todo
}

export function grantorAuthorisationClause(grantor: DesignationGrantor) {
  if (grantor.capacity !== 'пълномощник') return ''
  const clause = (grantor.authorisation.trim() || TODO_GRANTOR_AUTHORISATION).replace(/[.\s]+$/, '')
  return `, ${clause}.`
}

export function rightsMandateParagraph(person: DesignationPersonInput, config: DesignationConfig) {
  const district = districtLineOf(person.sectionCode)
  return `Да бъде ПРЕДСТАВИТЕЛ на ${config.committeeShortName} в изборния ден за ${config.electionName} на ${config.electionDate} г., както и при евентуален нов избор на ${config.runoffDate} г., в ${district}.`
}

export function territoryParagraph(config: DesignationConfig) {
  return `Представителят разполага с гореизброените права за всяка от избирателните секции на територията на изборния район, при условие, че носи утвърдения с ${config.distinctiveSignDecision} отличителен знак и в съответното изборно помещение не присъства друг представител или застъпник на ${config.committeeShortName}.`
}

export function termParagraph(config: DesignationConfig) {
  return `Настоящото пълномощно се издава със срок до ${formatBgDate(config.validUntil)} г., важи и за новия избор съгласно ${config.runoffLegalRef} и следва да се тълкува разширително в полза на упълномощеното лице.`
}

export function sectionInfoLine(person: DesignationPersonInput) {
  const code = person.sectionCode.trim() || '—'
  const place = person.sectionPlace.trim()
  return place ? `За информация: назначена секция № ${code}, ${place}.` : `За информация: назначена секция № ${code}.`
}

export function grantorOpening(grantor: DesignationGrantor, config: DesignationConfig) {
  const name = visibleOrTodo(grantor.name, TODO_GRANTOR_NAME)
  const egn = visibleOrTodo(grantor.egn, TODO_GRANTOR_EGN)
  return `Подписаният/ата ${name}, ЕГН ${egn}, в качеството ми на ${grantor.capacity} на ${config.committeeFullName}, учреден на ${config.committeeFoundedOn} г., регистриран с ${config.committeeDecision} за участие в ${config.electionName}, насрочени за ${config.electionDate} г.${grantorAuthorisationClause(grantor)}`
}

function splitBoldPhrase(text: string, phrase: string): TextRun[] {
  const at = text.indexOf(phrase)
  if (at < 0) return [{ text }]
  const runs: TextRun[] = []
  if (at > 0) runs.push({ text: text.slice(0, at) })
  runs.push({ text: phrase, bold: true })
  const rest = text.slice(at + phrase.length)
  if (rest) runs.push({ text: rest })
  return runs
}

export function displayedNumber(input: DesignationRenderInput, config: DesignationConfig) {
  if (typeof input.number === 'number' && Number.isFinite(input.number) && input.number > 0) {
    return formatDesignationNumber(input.number, config.numberPrefix)
  }
  const raw = String(input.number ?? '').trim()
  return raw || TODO_NUMBER
}

export function buildDesignationBlocks(input: DesignationRenderInput, config: DesignationConfig): DesignationBlock[] {
  const number = displayedNumber(input, config)
  const issuedOn = formatBgDate(input.issuedOn)
  const verb = verbForCapacity(input.grantor.capacity)
  const fullName = personFullName(input.person)
  const egn = visibleOrTodo(input.person.egn, TODO_PERSON_EGN)
  const grantorName = visibleOrTodo(input.grantor.name, TODO_GRANTOR_NAME)
  const mandate = rightsMandateParagraph(input.person, config)
  const territory = territoryParagraph(config)
  const blocks: DesignationBlock[] = [
    { type: 'title', text: 'П Ъ Л Н О М О Щ Н О' },
    { type: 'center', text: `№ ${number} / ${issuedOn} г.` },
    { type: 'spacer' },
    { type: 'paragraph', runs: [{ text: grantorOpening(input.grantor, config) }] },
    { type: 'spacer' },
    { type: 'center', text: `${verb}:` },
    { type: 'left', runs: [{ text: `${fullName}, ЕГН ${egn}` }] },
    { type: 'spacer' },
    { type: 'center', text: 'СЪС СЛЕДНИТЕ ПРАВА:' },
    { type: 'spacer' },
    { type: 'paragraph', runs: splitBoldPhrase(mandate, 'ПРЕДСТАВИТЕЛ'), firstLineIndent: true },
    { type: 'spacer' },
    { type: 'left', runs: [{ text: 'Представителят има право:' }] },
    { type: 'bullets', items: REPRESENTATIVE_RIGHTS.map((right, index) => `${RIGHTS_LETTERS[index]}) ${right}`) },
    { type: 'spacer' },
    { type: 'paragraph', runs: splitBoldPhrase(territory, config.committeeShortName) },
    { type: 'spacer' },
    { type: 'paragraph', runs: [{ text: termParagraph(config) }] },
    { type: 'spacer' },
    { type: 'paragraph', runs: [{ text: config.sealLine }] },
    { type: 'spacer' },
    { type: 'signature', grantorName },
  ]
  if (config.includeSectionInfoLine) {
    blocks.push({ type: 'info', text: sectionInfoLine(input.person) })
  }
  return blocks
}

export function designationPlainText(blocks: DesignationBlock[]) {
  const lines: string[] = []
  for (const block of blocks) {
    if (block.type === 'title' || block.type === 'center' || block.type === 'info') lines.push(block.text)
    else if (block.type === 'paragraph' || block.type === 'left') lines.push(block.runs.map((run) => run.text).join(''))
    else if (block.type === 'bullets') lines.push(...block.items)
    else if (block.type === 'signature') {
      lines.push('УПЪЛНОМОЩИТЕЛ:')
      lines.push('........................')
      lines.push(`/ ${block.grantorName} /`)
    }
  }
  return lines.join('\n')
}
