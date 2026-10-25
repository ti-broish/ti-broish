import { placeReady, validEmail, validPhone, type HomePlace } from './model'

export interface PhotoInput {
  contentType: string
  data: string
}

export interface StoredPhoto {
  contentType: 'image/jpeg'
  data: string
}

const MAX_PHOTO_CHARS = 400_000

export function cleanPhoto(photo: PhotoInput): StoredPhoto | string {
  const data = photo.data.replace(/^data:image\/jpeg;base64,/i, '').replace(/\s/g, '')
  const jpeg = photo.contentType === 'image/jpeg' || /^data:image\/jpeg;base64,/i.test(photo.data)
  if (!jpeg || !/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length < 32 || data.length > MAX_PHOTO_CHARS) {
    return 'Снимката е твърде голяма или не се чете. Опитай с друга.'
  }
  return { contentType: 'image/jpeg', data }
}

export function cleanPhotos(photos: PhotoInput[], min: number, max: number): StoredPhoto[] | string {
  if (photos.length < min) return min === 1 ? 'Добави снимка.' : `Качи поне ${min} снимки.`
  if (photos.length > max) return `Най-много ${max} снимки.`
  const stored: StoredPhoto[] = []
  for (const photo of photos) {
    const next = cleanPhoto(photo)
    if (typeof next === 'string') return next
    stored.push(next)
  }
  return stored
}

export interface ViolationInput {
  name: string
  email: string
  phone: string
  description: string
  place: HomePlace | null
  photos: PhotoInput[]
}

/** What the API needs for POST /violations. The town is the API town id; the section is optional. */
export interface ViolationPayload {
  name: string
  email: string
  phone: string
  description: string
  place: HomePlace & { townId: number }
}

/** The API accepts 20 to 2000 characters. */
export const VIOLATION_DESCRIPTION_MAX = 2000

export interface CallInput {
  name: string
  phone: string
  email: string
  message: string
}

function cleanText(value: string, max: number) {
  return value.trim().slice(0, max)
}

export function validateViolation(input: ViolationInput): { payload: ViolationPayload; photos: StoredPhoto[] } | string {
  const name = cleanText(input.name, 200)
  const email = cleanText(input.email, 200)
  const phone = cleanText(input.phone, 40)
  const description = input.description.trim()
  if (name.length < 2) return 'Напиши име.'
  if (!validEmail(email)) return 'Напиши валиден имейл.'
  if (!validPhone(phone)) return 'Напиши телефон.'
  if (description.length < 20) return 'Опиши нарушението с поне 20 знака.'
  if (description.length > VIOLATION_DESCRIPTION_MAX) return `Описанието е твърде дълго. Най-много ${VIOLATION_DESCRIPTION_MAX} знака.`
  const place = input.place
  if (!place || !placeReady(place)) return 'Избери населено място.'
  if (!place.townId) return 'Избери населеното място от списъка.'
  if (place.sectionId && !/^\d{9}$/.test(place.sectionId)) return 'Секцията не е валидна. Избери я пак от списъка.'
  const photos = cleanPhotos(input.photos, 0, 6)
  if (typeof photos === 'string') return photos
  return {
    payload: { name, email, phone, description, place: { ...place, townId: place.townId } },
    photos,
  }
}

export function validateCall(input: CallInput) {
  const name = cleanText(input.name, 200)
  const phone = cleanText(input.phone, 40)
  const email = cleanText(input.email, 200)
  const message = cleanText(input.message, 1000)
  if (name.length < 2) return 'Напиши име.'
  if (!validPhone(phone)) return 'Напиши телефон.'
  if (email && !validEmail(email)) return 'Имейлът не е валиден.'
  return { payload: { name, phone, email, message } }
}
