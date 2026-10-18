import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { loadBrevoSectionFields } from './admin'
import type { BrevoSectionFields } from './admin-csv'
import { brevoCampaignName, brevoCampaignUrl } from './brevo-campaign'
import { brevoAttributesForApi, buildBrevoContact } from './brevo-contact'
import {
  BrevoApiError,
  createEmailCampaign,
  fetchBrevoAttributeDescriptors,
  fetchBrevoHealth,
  fetchBrevoList,
  fetchBrevoLists,
  fetchBrevoProcess,
  importContactsToList,
  readBrevoConfig,
  sendEmailCampaignNow,
  type BrevoConfig,
  type BrevoListSummary,
} from './brevo'
import {
  brevoProcessReport,
  chunkContacts,
  type BrevoProcessReport,
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

export const adminBrevoLists = createServerFn({ method: 'POST' })
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
      const lists = await fetchBrevoLists(config)
      return {
        ok: true as const,
        configured: true as const,
        lists,
        defaultListId: config.listId,
      }
    } catch (error) {
      return {
        ok: false as const,
        message: errorMessage(error),
        defaultListId: config.listId,
      }
    }
  })

export const adminBrevoPrepareCampaign = createServerFn({ method: 'POST' })
  .validator((input: { view: string; mir: string; q?: string; subject: string; sendNow: boolean; listId?: string }) => ({
    view: input.view,
    mir: input.mir,
    q: (input.q ?? '').slice(0, 120),
    subject: input.subject,
    sendNow: input.sendNow === true,
    listId: (input.listId ?? '').trim(),
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
    if (data.listId && !parseListId(data.listId)) {
      return { ok: false as const, message: 'List ID трябва да е положително число.' }
    }
    const listId = parseListId(data.listId) ?? config.listId
    if (!listId) {
      return {
        ok: false as const,
        message: 'Нужен е списък в Brevo: избери списък или задай BREVO_LIST_ID.',
      }
    }

    let list: BrevoListSummary
    try {
      list = await fetchBrevoList(config, listId)
    } catch (error) {
      return { ok: false as const, message: errorMessage(error) }
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
    let imported = 0
    let campaignId: number | null = null

    try {
      for (const batch of chunkContacts(contacts)) {
        await importContactsToList(config, batch, list.id)
        imported += batch.length
      }
      const subject = data.subject.trim() || 'Кампания Ти Броиш'
      const campaign = await createEmailCampaign(config, {
        name: brevoCampaignName(subject, new Date()),
        subject,
        listId: list.id,
        templateId: config.templateId ?? undefined,
      })
      campaignId = campaign.id
      let sent = false
      if (data.sendNow) {
        await sendEmailCampaignNow(config, campaign.id)
        sent = true
      }
      return {
        ok: true as const,
        contacts: imported,
        listId: list.id,
        listName: list.name,
        campaignId: campaign.id,
        campaignUrl: brevoCampaignUrl(campaign.id),
        sent,
        message: sent
          ? `Кампания ${campaign.id} е създадена и пратена към списък „${list.name}“ (${list.id}) (${imported} контакта).`
          : `Кампания ${campaign.id} е създадена като чернова за списък „${list.name}“ (${list.id}) (${imported} контакта). Не е пратена.`,
      }
    } catch (error) {
      const done = campaignId ? ` Кампания ${campaignId} е създадена, но не е пратена.` : ''
      return {
        ok: false as const,
        contacts: imported,
        listId: list.id,
        listName: list.name,
        campaignId,
        campaignUrl: campaignId ? brevoCampaignUrl(campaignId) : null,
        message: `${errorMessage(error)} (внесени ${imported} от ${contacts.length} контакта.)${done}`,
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

    if (data.listId && !parseListId(data.listId)) {
      return { ok: false as const, message: 'List ID трябва да е положително число.' }
    }
    const listId = parseListId(data.listId) ?? config.listId
    if (!listId) {
      return {
        ok: false as const,
        message: 'Нужен е списък в Brevo: избери списък или задай BREVO_LIST_ID.',
      }
    }

    let list: BrevoListSummary
    try {
      list = await fetchBrevoList(config, listId)
    } catch (error) {
      return { ok: false as const, message: errorMessage(error) }
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
        listId: list.id,
        listName: list.name,
        samples,
        lackingSection,
        lackingSms,
        message: `Ще се синхронизират ${rows.length} контакта към списък „${list.name}“ (${list.id}).`,
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
          const result = await importContactsToList(config, batch, list.id)
          const processId = extractProcessId(result)
          if (processId !== null) processIds.push(processId)
          sent += batch.length
        } catch (error) {
          errors.push(`Партида ${index + 1}: ${errorMessage(error)}`)
        }
      }

      const processReports = await waitForProcesses(config, processIds)
      const rejected = processReports.flatMap((report) => report.issues.map((issue) => `Процес ${report.id}: ${issue}`))
      const pending = processReports.filter((report) => report.status !== 'completed').map((report) => `${report.id} (${report.status})`)

      return {
        ok: true as const,
        dryRun: false as const,
        total: rows.length,
        sent,
        failedBatches: errors.length,
        processIds,
        processReports,
        rejected,
        pending,
        errors,
        roleWarnings,
        listId: list.id,
        listName: list.name,
        message:
          errors.length === 0
            ? `Синхронизирани ${sent} от ${rows.length} контакта към списък „${list.name}“ (${list.id}).`
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

/** Brevo imports run in the background. Wait briefly so the admin sees rejected rows (e.g. an SMS already on another contact). */
async function waitForProcesses(config: BrevoConfig, processIds: Array<string | number>): Promise<BrevoProcessReport[]> {
  const reports: BrevoProcessReport[] = []
  for (const id of processIds.slice(0, 10)) {
    let report: BrevoProcessReport = { id, status: 'unknown', issues: [] }
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      try {
        report = brevoProcessReport(id, await fetchBrevoProcess(config, id))
      } catch (error) {
        report = { id, status: 'unknown', issues: [errorMessage(error)] }
        break
      }
      if (report.status === 'completed') break
    }
    reports.push(report)
  }
  return reports
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
