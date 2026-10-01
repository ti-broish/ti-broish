import { EXPERIENCE, placeLabel, radiusOptions, roleLabel, type Profile } from './model'

/** D1's meta.changes includes the signup search trigger, so a claimed row is any positive count. */
export function receiptClaimed(changes: number | null) {
  return changes !== null && changes > 0
}

export function signupReceiptMail(profile: Profile, profileUrl: string) {
  const name = [profile.firstName, profile.middleName, profile.lastName].map((part) => part.trim()).filter(Boolean).join(' ')
  const days = [profile.rounds.first ? '25 октомври' : '', profile.rounds.runoff ? '1 ноември' : ''].filter(Boolean)
  const experience = EXPERIENCE.find((item) => item.id === profile.experience)?.title
  const reach = radiusOptions(profile.place).find((item) => item.id === profile.radius)?.label
  const group = profile.companions.filter((person) => person.inGroup !== false && person.firstName.trim())
  const lines = [
    name ? `Име: ${name}` : '',
    profile.phone.trim() ? `Телефон: ${profile.phone.trim()}` : '',
    `Роля: ${roleLabel(profile.role, profile.mobileTeam)}`,
    days.length > 0 ? `Дни: ${days.join(' и ')}` : '',
    experience ? `Опит: ${experience}` : '',
    profile.place ? `Място: ${placeLabel(profile.place)}` : '',
    reach ? `Докъде: ${reach}` : '',
    profile.role === 'mobile' ? (profile.hasCar ? `Кола, ${profile.carSeats} свободни места` : 'Без кола') : '',
    profile.role === 'mobile' ? (profile.hasDrone ? 'Има дрон' : 'Без дрон') : '',
    profile.role !== 'mobile' && profile.carSeats > 0 ? `${profile.carSeats} свободни места` : '',
    group.length > 0 ? `Група: ${group.map((person) => `${person.firstName} ${person.lastName}`.trim()).join(', ')}` : '',
  ].filter(Boolean)
  const text = [
    profile.firstName.trim() ? `Здравей, ${profile.firstName.trim()},` : 'Здравей,',
    'Записването ти е прието. Ето какво записахме.',
    ...lines,
    'Секцията още не е определена. Ще я видиш в профила, когато я публикуваме.',
    `Отвори профила: ${profileUrl}`,
    'Записването е за президентските избори 2026 г. на 25 октомври и 1 ноември.',
    'Това е доброволна дейност без заплащане. Ще бъдете представител на Инициативния комитет за кандидат-президентската двойка Андрей Гюров и Георги Кандев.',
  ].join('\n\n')
  const href = escapeHtml(profileUrl)
  const html = [
    `<p>${escapeHtml(profile.firstName.trim() ? `Здравей, ${profile.firstName.trim()},` : 'Здравей,')}</p>`,
    '<p>Записването ти е прието. Ето какво записахме.</p>',
    ...lines.map((line) => `<p>${escapeHtml(line)}</p>`),
    '<p>Секцията още не е определена. Ще я видиш в профила, когато я публикуваме.</p>',
    `<p><a href="${href}">Отвори профила</a></p>`,
    '<p>Записването е за президентските избори 2026 г. на 25 октомври и 1 ноември.</p>',
    '<p>Това е доброволна дейност без заплащане. Ще бъдете представител на Инициативния комитет за кандидат-президентската двойка Андрей Гюров и Георги Кандев.</p>',
  ].join('')
  return {
    to: profile.email.trim(),
    subject: 'Записването ти е прието — Ти Броиш',
    text,
    html,
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char)
}
