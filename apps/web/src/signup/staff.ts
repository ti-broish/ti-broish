export const STAFF_ROLES = ['viewer', 'editor', 'admin'] as const

export type StaffRole = (typeof STAFF_ROLES)[number]

/** revealEgn: see one person's full ЕГН on their profile (admins only; every reveal is audited). */
export type StaffAction = 'view' | 'edit' | 'exportCampaign' | 'exportInternal' | 'publish' | 'invite' | 'revealEgn'

const ALLOWED: Record<StaffRole, readonly StaffAction[]> = {
  viewer: ['view'],
  editor: ['view', 'edit', 'exportCampaign'],
  admin: ['view', 'edit', 'exportCampaign', 'exportInternal', 'publish', 'invite', 'revealEgn'],
}

export function parseStaffRole(value: string | null | undefined): StaffRole | null {
  return STAFF_ROLES.includes(value as StaffRole) ? (value as StaffRole) : null
}

export function roleAllows(role: StaffRole | null, action: StaffAction) {
  return Boolean(role && ALLOWED[role].includes(action))
}

export function permissionsFor(role: StaffRole) {
  return {
    edit: roleAllows(role, 'edit'),
    exportCampaign: roleAllows(role, 'exportCampaign'),
    exportInternal: roleAllows(role, 'exportInternal'),
    publish: roleAllows(role, 'publish'),
    invite: roleAllows(role, 'invite'),
    revealEgn: roleAllows(role, 'revealEgn'),
  }
}

export function staffRoleLabel(role: StaffRole) {
  if (role === 'admin') return 'Админ'
  if (role === 'editor') return 'Редактор'
  return 'Преглед'
}

export function parseAdminEmails(value: string | undefined) {
  const seen = new Set<string>()
  for (const part of (value ?? '').split(/[,;\s]+/)) {
    const email = part.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue
    seen.add(email)
  }
  return [...seen]
}

export function keepsAnAdmin(adminCount: number, currentRole: StaffRole, nextRole: StaffRole | null) {
  if (currentRole !== 'admin') return true
  if (nextRole === 'admin') return true
  return adminCount > 1
}
