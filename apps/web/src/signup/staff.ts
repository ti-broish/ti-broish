export const STAFF_ROLES = ['viewer', 'editor', 'admin'] as const

export type StaffRole = (typeof STAFF_ROLES)[number]

export type StaffAction = 'view' | 'edit' | 'exportCampaign' | 'exportInternal' | 'publish' | 'invite'

const ALLOWED: Record<StaffRole, readonly StaffAction[]> = {
  viewer: ['view'],
  editor: ['view', 'edit', 'exportCampaign'],
  admin: ['view', 'edit', 'exportCampaign', 'exportInternal', 'publish', 'invite'],
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
