import { adminPartnerPublish, adminPartnerSave } from '../../signup/partner-sections-admin'
import { adminDraft, adminPublish } from '../../signup/admin-assign-actions'
import { withOtherMirConfirm, withOtherMirConfirmIds } from '../../signup/egn-mir-conflict'

/**
 * Every admin section save/publish goes through here: when the same ЕГН already holds a пълномощно
 * in another МИР the server holds it back, staff see the warning in a confirm, and only „OK“ re-sends
 * with the confirm flag. Same МИР: no prompt.
 */
export function partnerSaveConfirmed(id: string, section: string) {
  return withOtherMirConfirm((confirmOtherMir) => adminPartnerSave({ data: { id, section, confirmOtherMir } }))
}

export function draftConfirmed(id: string, section: string) {
  return withOtherMirConfirm((confirmOtherMir) => adminDraft({ data: { id, section, confirmOtherMir } }))
}

type PartnerPublishResult = Awaited<ReturnType<typeof adminPartnerPublish>>

export async function partnerPublishConfirmed(ids?: string[]): Promise<PartnerPublishResult> {
  const { first, second } = await withOtherMirConfirmIds(
    (confirmOtherMir) => adminPartnerPublish({ data: { ...(ids ? { ids } : {}), confirmOtherMir } }),
    (result) => (result.ok && 'blocked' in result ? result.blocked.filter((row) => row.confirm).map((row) => ({ id: row.id, message: row.reason })) : []),
  )
  if (!second || !second.ok || !first.ok || !('published' in first) || !('published' in second)) return second ?? first
  return { ...second, published: first.published + second.published, message: first.published ? `${first.message} След потвърждение: ${second.message}` : second.message }
}

type PublishInput = { view: string; mir: string; ids?: string[] }
type PublishResult = Awaited<ReturnType<typeof adminPublish>>

export async function publishConfirmed(input: PublishInput): Promise<PublishResult> {
  const { first, second } = await withOtherMirConfirmIds(
    (confirmOtherMir) => adminPublish({ data: { ...input, confirmOtherMir } }),
    (result) => {
      if (!result.ok || !('blocked' in result)) return []
      const volunteers = result.blocked.flatMap((row) => (row.confirmId ? [{ id: row.confirmId, message: row.warning }] : []))
      const partners = (result.partnersBlocked ?? []).flatMap((row) => ('confirmId' in row && row.confirmId ? [{ id: row.confirmId, message: row.warning }] : []))
      return [...volunteers, ...partners]
    },
  )
  if (!second || !second.ok || !first.ok || !('published' in first) || !('published' in second)) return second ?? first
  return {
    ...second,
    published: first.published + second.published,
    partnersPublished: (first.partnersPublished ?? 0) + (second.partnersPublished ?? 0),
    advance: [first.advance, second.advance].filter(Boolean).join(' '),
  }
}
