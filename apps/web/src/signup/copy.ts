export const joinIntro =
  'Можеш да се включиш по два начина — пазител за хартиена секция или част от мобилен екип.'

export const paperSectionText =
  'За тези избори е необходимо да имаме покритие в секциите, в които ще се гласува с хартия (с под 300 човека по избирателен списък). В секциите с машина ще упълномощавам хора само ако имат висок приоритет.'

export const mobileTeamText =
  'Ще съставим екипи за различните населени места и рисковите секции в тях. Още при регистрацията може да добавиш и други хора и да отидете заедно като група.'

export const votingLogistics =
  'Гласуваш в секцията, в чийто избирателен списък си записан и след това можеш да се насочиш към секцията, която сме потвърдили с теб. Ако двете съвпадат — чудесно, ако ли не предвиди, че ще ти е необходима логистика и време за пътуване.'

export const assignmentTiming =
  'В профила виждаш датата, на която ще разпределяме секциите: 5, 12 или 19 октомври, и 26 октомври за балотажа, на следващия ден ще има съобщение от нас, което е необходимо да потвърдиш, за да можем да задействаме процедурата по регистрация.'

/** After the first round: admins assign runoff sections by hand, no fixed date and no letter. */
export const runoffAssignmentTiming = (runoffLabel: string) =>
  `След записването ще разпределяме секциите за балотажа на ${runoffLabel}. Секцията ще видиш в профила си.`

export const groupWithYou =
  'Можеш да добавиш и други хора в група с теб, но всеки от тях е необходимо да потвърди електронната си поща.'

export const groupAsCoordinator =
  'Тези хора не са в твоята група. Записваш ги като координатор и всеки потвърждава своя имейл.'

/** The legal facts every signup screen and letter repeats, in the informal „ти“ the site uses. */
export const volunteerNotice =
  'Това е доброволна дейност без заплащане. Ще бъдеш представител на Инициативния комитет за кандидат-президентската двойка Андрей Гюров и Георги Кандев.'

/** Which election a signup is for: after the first round, the runoff alone. */
export function signupScope(runoffOnly: boolean, electionLabel: string, runoffLabel: string) {
  return runoffOnly
    ? `Записването е за балотажа на президентските избори на ${runoffLabel} 2026 г.`
    : `Записването е за президентските избори 2026 г. на ${electionLabel} и ${runoffLabel}.`
}

/**
 * „в“ or „във“ before a place name: „във“ when the next word starts with „в“ or „ф“
 * (Във Варна, във Враца, във Франция), „в“ otherwise. `capital` starts a sentence or a label.
 */
export function inPlace(name: string, capital = false) {
  const first = name.trim().charAt(0).toLowerCase()
  const word = first === 'в' || first === 'ф' ? 'във' : 'в'
  const prep = capital ? word.charAt(0).toUpperCase() + word.slice(1) : word
  return `${prep} ${name.trim()}`
}
