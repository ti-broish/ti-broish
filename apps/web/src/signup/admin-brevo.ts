import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { rosterWhere, type RosterView } from './admin-csv'
import {
  createEmailCampaign,
  importContactsToList,
  readBrevoConfig,
  sendEmailCampaignNow,
} from './brevo'
import { SESSION_COOKIE, signupDatabase, type SignupD1 } from './db-core'
import { parseStaffRole, roleAllows, type StaffAction, type StaffRole } from './staff'

type Database = SignupD1
type Denial = { ok: false; state: 'signed-out' | 'unconfirmed' | 'forbidden' | 'nodb'; email: string; message: string }

const VIEWS: RosterView[] = ['all', 'finished', 'started', 'assigned', 'unassigned', 'draft', 'abroad', 'mir', 'calls']

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

export const adminBrevoPrepareCampaign = createServerFn({ method: 'POST' })
  .validator((input: { view: string; mir: string; subject: string; sendNow: boolean }) => input)
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

    const filter = rosterWhere(viewOf(data.view), data.mir)
    if ('error' in filter) return { ok: false as const, message: filter.error }

    const people = await loadCampaignPeople(access.db, filter.clause, filter.binds)
    if (people.length === 0) return { ok: false as const, message: 'Няма хора в този изглед за кампания.' }

    const contacts = people.map((person) => ({
      email: person.email,
      attributes: {
        FIRSTNAME: person.firstName,
        LASTNAME: person.lastName,
        SMS: person.phone,
        MIR: person.mir,
        PLACE: person.place,
        SECTION: person.publishedSection,
      },
    }))

    try {
      await importContactsToList(config, contacts, config.listId)
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
          : `Кампания ${campaign.id} е създадена като чернова за списък ${config.listId} (${contacts.length} контакта). Изпрати я от Brevo или с sendNow.`,
      }
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : 'Brevo повикването се провали.',
      }
    }
  })

async function loadCampaignPeople(db: Database, clause: string, binds: string[]) {
  const sql = `SELECT email,
    COALESCE(json_extract(payload, '$.firstName'), '') AS first_name,
    COALESCE(json_extract(payload, '$.lastName'), '') AS last_name,
    COALESCE(json_extract(payload, '$.phone'), '') AS phone,
    COALESCE(mir_code, '') AS mir,
    COALESCE(section_place, '') AS place,
    COALESCE(published_section, '') AS published_section
    FROM signups WHERE ${clause} ORDER BY updated_at DESC LIMIT 5000`
  const statement = binds.length > 0 ? db.prepare(sql).bind(...binds) : db.prepare(sql)
  const rows = await statement.all<{
    email: string
    first_name: string
    last_name: string
    phone: string
    mir: string
    place: string
    published_section: string
  }>()
  return (rows.results ?? []).map((row) => ({
    email: row.email.trim().toLowerCase(),
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
    mir: row.mir,
    place: row.place,
    publishedSection: row.published_section,
  }))
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

function viewOf(value: string): RosterView {
  return VIEWS.includes(value as RosterView) ? (value as RosterView) : 'all'
}
