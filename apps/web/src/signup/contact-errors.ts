import { validEmail, validName, validPhone, type Profile } from './model'

// The contact step's messages, one per field. The rule stays the same (all three names, in Cyrillic,
// a valid e-mail and phone); only the message now says which field and what is wrong.

export type ContactField = 'firstName' | 'middleName' | 'lastName' | 'email' | 'phone'

export const CYRILLIC_MESSAGE = 'Имената трябва да са на кирилица.'

const nameWords: Record<'firstName' | 'middleName' | 'lastName', string> = {
  firstName: 'име',
  middleName: 'презиме',
  lastName: 'фамилия',
}

export function nameError(field: 'firstName' | 'middleName' | 'lastName', value: string) {
  const trimmed = value.trim()
  if (!trimmed) return `Въведи ${nameWords[field]}.`
  if (validName(trimmed)) return ''
  if (/[^\u0400-\u04FF\s'-]/.test(trimmed) || !/^[\u0400-\u04FF]/.test(trimmed)) return CYRILLIC_MESSAGE
  return `Напиши цялото ${nameWords[field]}.`
}

export function emailError(value: string) {
  if (!value.trim()) return 'Въведи имейл.'
  return validEmail(value) ? '' : 'Провери имейла — изглежда непълен (напр. ime@primer.bg).'
}

export function phoneError(value: string) {
  if (!value.trim()) return 'Въведи телефон.'
  return validPhone(value) ? '' : 'Провери телефона — трябва да е от 9 до 13 цифри.'
}

/** Every contact field's message ('' when the field is fine). */
export function contactErrors(profile: Pick<Profile, ContactField>): Record<ContactField, string> {
  return {
    firstName: nameError('firstName', profile.firstName),
    middleName: nameError('middleName', profile.middleName),
    lastName: nameError('lastName', profile.lastName),
    email: emailError(profile.email),
    phone: phoneError(profile.phone),
  }
}

export function contactValid(profile: Pick<Profile, ContactField>) {
  return Object.values(contactErrors(profile)).every((message) => !message)
}
