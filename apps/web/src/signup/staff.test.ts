import { describe, expect, it } from 'vitest'
import { keepsAnAdmin, parseAdminEmails, permissionsFor, roleAllows } from './staff'

describe('staff roles', () => {
  it('lets a viewer look and nothing else', () => {
    expect(roleAllows('viewer', 'view')).toBe(true)
    expect(permissionsFor('viewer')).toEqual({
      edit: false,
      exportCampaign: false,
      exportInternal: false,
      publish: false,
      invite: false,
    })
  })

  it('lets an editor draft and export the campaign file, and an admin invite and publish', () => {
    expect(roleAllows('editor', 'edit')).toBe(true)
    expect(roleAllows('editor', 'exportCampaign')).toBe(true)
    expect(roleAllows('editor', 'publish')).toBe(false)
    expect(roleAllows('editor', 'invite')).toBe(false)
    expect(roleAllows('editor', 'exportInternal')).toBe(false)
    expect(roleAllows('admin', 'publish')).toBe(true)
    expect(roleAllows('admin', 'invite')).toBe(true)
    expect(roleAllows(null, 'view')).toBe(false)
  })

  it('reads the first admin emails and refuses to remove the last admin', () => {
    expect(parseAdminEmails(' Ada@Example.com, ada@example.com not-an-email;editor@example.com ')).toEqual(['ada@example.com', 'editor@example.com'])
    expect(keepsAnAdmin(1, 'admin', 'editor')).toBe(false)
    expect(keepsAnAdmin(1, 'admin', null)).toBe(false)
    expect(keepsAnAdmin(2, 'admin', null)).toBe(true)
    expect(keepsAnAdmin(1, 'editor', null)).toBe(true)
  })
})
