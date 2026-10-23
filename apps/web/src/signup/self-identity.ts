/** Shared by the volunteer forms (client) and identity-fix.ts (server): no server imports here. */
export const SELF_CHANGE_CONFIRM = 'Сигурни ли сте? Ще трябва да издадем ново пълномощно и да коригираме данните в РИК.'

export interface SelfIdentity {
  firstName: string
  middleName: string
  lastName: string
  egn: string
}
