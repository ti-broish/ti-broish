import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { loadBrevoSectionFields } from './admin'
import type { BrevoSectionFields } from './admin-csv'
import { brevoAttributesForApi, buildBrevoContact } from './brevo-contact'
import {
  BrevoApiError,
  createEmailCampaign,
  fetchBrevoAttributeDescriptors,
  fetchBrevoHealth,
  importContactsToList,
  readBrevoConfig,
  sendEmailCampaignNow,
  type BrevoConfig,
} from './brevo'
import {
  chunkContacts,
  convertRoleForBrevo,
  maskEmail,
  type BrevoAttrDescriptor,
  type BrevoImportContact,
} from './brevo-sync'
import { SESSION_COOKIE, signupDatabase, type SignupD1 } from './db-core'
import { parseStaffRole, roleAllows, type StaffAction, type StaffRole } from './staff'

type Database = SignupD1
type Denial = { ok: false; state: 'signed-out' | 'unconfirmed' | 'forbidden' | 'nodb'; email: string; message: string }

export const adminBrevoStatus = createServerFn({ method: 'POST' })
  .handler(async () => {
    const access = await gate('exportCampaign')
    if (!access.ok) return access
    const config = readBrevoConfig()
    if ('missing' in config) {
      return {
        ok: true as const,
        configured: false as const,
        missing: config.missing,
        hint: 'Добави wrangler secret BREVO_API_KEY (и по желание BREVO_LIST_ID, BREVO_TEMPLATE_ID, BREVO_SENDER_EMAIL, BREVO_SENDER_NAME). CSV експортът остава.',
      }
    }
    return {
      ok: true as const,
      configured: true as const,
      listId: config.listId,
      templateId: config.templateId,
      senderEmail: config.senderEmail,
      senderName: config.senderName,
    }
  })

export const adminBrevoHealth = createServerFn({ method: 'POST' })
  .handler(async () => {
    const access = await gate('exportCampaign')
    if (!access.ok) return access
    const config = readBrevoConfig()
    if ('missing' in config) {
      return {
        ok: true as const,
        configured: false as const,
        missing: config.missing,
        message: 'Липсва BREVO_API_KEY.',
      }
    }
    try {
      const health = await fetchBrevoHealth(config)
      return { ok: true as const, configured: true as const, health }
    } catch (error) {
      return {
        ok: false as const,
        message: errorMessage(error),
      }
    }
  })

export const adminBrevoPrepareCampaign = createServerFn({ method: 'POST' })
  .validator((input: { view: string; mir: string; q?: string; subject: string; sendNow: boolean }) => ({
    view: input.view,
    mir: input.mir,
    q: (input.q ?? '').slice(0, 120),
    subject: input.subject,
    sendNow: input.sendNow === true,
  }))
  .handler(async ({ data }) => {
    const access = await gate('exportCampaign')
    if (!access.ok) return access
    const config = readBrevoConfig()
    if ('missing' in config) {
      return {
        ok: false as const,
        message: 'Липсва BREVO_API_KEY. Задай го с `wrangler secret put BREVO_API_KEY` и презареди. Дотогава ползвай CSV за Brevo.',
      }
    }
    if (!config.listId) {
      return {
        ok: false as const,
        message: 'Задай BREVO_LIST_ID (числов ID на списък в Brevo), към който да се синхронизират контактите.',
      }
    }

    const rows = await loadBrevoSectionFields(access.db, {
      view: data.view,
      mir: data.mir,
      q: data.q,
      publishedOnly: false,
    })
    if ('error' in rows) return { ok: false as const, message: rows.error }
    if (rows.length === 0) return { ok: false as const, message: 'Няма хора в този изглед за кампания.' }

    const contacts = await toImportContacts(config, rows)

    try {
      for (const batch of chunkContacts(contacts)) {
        await importContactsToList(config, batch, config.listId)
      }
      const subject = data.subject.trim() || 'Кампания Ти Броиш'
      const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
      const campaign = await createEmailCampaign(config, {
        name: `Ти Броиш ${stamp}`,
        subject,
        listId: config.listId,
        templateId: config.templateId ?? undefined,
      })
      let sent = false
      if (data.sendNow) {
        await sendEmailCampaignNow(config, campaign.id)
        sent = true
      }
      return {
        ok: true as const,
        contacts: contacts.length,
        campaignId: campaign.id,
        sent,
        message: sent
          ? `Кампания ${campaign.id} е създадена и пратена към списък ${config.listId} (${contacts.length} контакта).`
          : `Кампания ${campaign.id} е създадена като чернова за списък ${config.listId} (${contacts.length} контакта). Изпрати я от Brevo или с „изпрати сега“.`,
      }
    } catch (error) {
      return {
        ok: false as const,
        message: errorMessage(error),
      }
    }
  })

export const adminBrevoSyncSections = createServerFn({ method: 'POST' })
  .validator((input: { view: string; mir: string; q?: string; listId?: string; dryRun: boolean }) => ({
    view: input.view,
    mir: input.mir,
    q: (input.q ?? '').slice(0, 120),
    listId: (input.listId ?? '').trim(),
    dryRun: input.dryRun !== false,
  }))
  .handler(async ({ data }) => {
    const access = await gate('exportCampaign')
    if (!access.ok) return access
    const config = readBrevoConfig()
    if ('missing' in config) {
      return {
        ok: false as const,
        message: 'Липсва BREVO_API_KEY. Задай го с `wrangler secret put BREVO_API_KEY` и презареди.',
      }
    }

    const listId = parseListId(data.listId) ?? config.listId
    if (!listId) {
      return {
        ok: false as const,
        message: 'Нужен е списък в Brevo: въведи list id или задай BREVO_LIST_ID.',
      }
    }

    const rows = await loadBrevoSectionFields(access.db, {
      view: data.view,
      mir: data.mir,
      q: data.q,
      publishedOnly: true,
    })
    if ('error' in rows) return { ok: false as const, message: rows.error }

    const lackingSection = rows.filter((row) => !row.sectionPublished || !/^\d{9}$/.test(row.publishedSection.replace(/\D/g, ''))).length
    const lackingSms = rows.filter((row) => {
      const built = buildBrevoContact({ ...row, sectionPublished: row.sectionPublished !== false })
      return !built.attributes.SMS
    }).length
    const samples = rows.slice(0, 3).map((row) => maskEmail(row.email))

    if (data.dryRun) {
      return {
        ok: true as const,
        dryRun: true as const,
        total: rows.length,
        listId,
        samples,
        lackingSection,
        lackingSms,
        message: `Ще се синхронизират ${rows.length} контакта към списък ${listId}.`,
      }
    }

    try {
      const { contacts, roleWarnings } = await toImportContactsWithWarnings(config, rows)
      const batches = chunkContacts(contacts)
      const processIds: Array<string | number> = []
      const errors: string[] = []
      let sent = 0

      for (let index = 0; index < batches.length; index += 1) {
        const batch = batches[index]!
        try {
          const result = await importContactsToList(config, batch, listId)
          const processId = extractProcessId(result)
          if (processId !== null) processIds.push(processId)
          sent += batch.length
        } catch (error) {
          errors.push(`Партида ${index + 1}: ${errorMessage(error)}`)
        }
      }

      return {
        ok: true as const,
        dryRun: false as const,
        total: rows.length,
        sent,
        failedBatches: errors.length,
        processIds,
        errors,
        roleWarnings,
        listId,
        message:
          errors.length === 0
            ? `Синхронизирани ${sent} от ${rows.length} контакта към списък ${listId}.`
            : `Синхронизирани ${sent} от ${rows.length}; ${errors.length} партиди с грешка.`,
      }
    } catch (error) {
      return { ok: false as const, message: errorMessage(error) }
    }
  })

async function toImportContacts(config: BrevoConfig, rows: BrevoSectionFields[]): Promise<BrevoImportContact[]> {
  const { contacts } = await toImportContactsWithWarnings(config, rows)
  return contacts
}

async function toImportContactsWithWarnings(
  config: BrevoConfig,
  rows: BrevoSectionFields[],
): Promise<{ contacts: BrevoImportContact[]; roleWarnings: number }> {
  let roleAttr: BrevoAttrDescriptor | null = null
  try {
    const attrs = await fetchBrevoAttributeDescriptors(config)
    roleAttr = attrs.find((attr) => attr.name.toUpperCase() === 'ROLE') ?? null
  } catch {
    roleAttr = null
  }

  let roleWarnings = 0
  const contacts: BrevoImportContact[] = rows.map((row) => {
    const built = buildBrevoContact({
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      phone: row.phone,
      mir: row.mir,
      publishedSection: row.publishedSection,
      sectionAddress: row.sectionAddress,
      sectionPlace: row.sectionPlace,
      role: row.role,
      sectionPublished: row.sectionPublished !== false,
      palnomoshtnoUrl: row.palnomoshtnoUrl,
    })
    const attributes = brevoAttributesForApi(built.attributes) as Record<string, string | number | boolean | string[]>
    if (built.attributes.ROLE) {
      const converted = convertRoleForBrevo(built.attributes.ROLE, roleAttr)
      if (converted.ok) attributes.ROLE = converted.value
      else {
        delete attributes.ROLE
        roleWarnings += 1
      }
    }
    return { email: built.email, attributes }
  })
  return { contacts, roleWarnings }
}

function extractProcessId(result: unknown): string | number | null {
  if (!result || typeof result !== 'object') return null
  const bag = result as { processId?: unknown; id?: unknown }
  if (typeof bag.processId === 'string' || typeof bag.processId === 'number') return bag.processId
  if (typeof bag.id === 'string' || typeof bag.id === 'number') return bag.id
  return null
}

function parseListId(value: string) {
  if (!/^\d+$/.test(value)) return null
  const n = Number(value)
  return n > 0 ? n : null
}

function errorMessage(error: unknown) {
  if (error instanceof BrevoApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Brevo повикването се провали.'
}

async function gate(action: StaffAction): Promise<{ ok: true; db: Database; email: string; role: StaffRole } | Denial> {
  const db = await signupDatabase()
  if (!db) return { ok: false, state: 'nodb', email: '', message: 'Няма база за записванията.' }
  const token = getCookie(SESSION_COOKIE)
  if (!token) return { ok: false, state: 'signed-out', email: '', message: 'Влез с потвърдения си имейл.' }
  const session = await db.prepare('SELECT email, email_confirmed FROM signups WHERE session_token = ?').bind(token).first<{ email: string; email_confirmed: number }>()
  if (!session) return { ok: false, state: 'signed-out', email: '', message: 'Влез с потвърдения си имейл.' }
  const email = session.email.trim().toLowerCase()
  if (!session.email_confirmed) return { ok: false, state: 'unconfirmed', email, message: 'Потвърди имейла, за да влезеш в екипа.' }
  const member = await db.prepare('SELECT role FROM staff WHERE email = ?').bind(email).first<{ role: string }>()
  const role = parseStaffRole(member?.role)
  if (!role) return { ok: false, state: 'forbidden', email, message: 'Този имейл не е поканен в екипа.' }
  if (!roleAllows(role, action)) return { ok: false, state: 'forbidden', email, message: 'Тази роля няма това право.' }
  return { ok: true, db, email, role }
}
