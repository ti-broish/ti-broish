import { describe, expect, it } from 'vitest'
import {
  classifyAdminSearch,
  escapeFtsQuery,
  parseQueueSearch,
  parseSignupSearch,
  rosterOrder,
  searchClause,
} from './admin-search'
import { validEgn } from './rules'

describe('classifyAdminSearch', () => {
  it('treats a 10-digit national number as an EGN, with a soft validity flag', () => {
    const valid = classifyAdminSearch('0041010002')
    expect(valid.kind).toBe('egn')
    expect(valid.egn).toBe('0041010002')
    expect(valid.egnValid).toBe(validEgn('0041010002'))
    const spaced = classifyAdminSearch('0000 0000 00')
    expect(spaced.kind).toBe('egn')
    expect(spaced.egn).toBe('0000000000')
    expect(spaced.egnValid).toBe(false)
  })

  it('prefers a Bulgarian phone over a 10-digit EGN', () => {
    expect(classifyAdminSearch('0888123456').kind).toBe('phone')
    expect(classifyAdminSearch('0888 123 456').kind).toBe('phone')
    expect(classifyAdminSearch('+359 888 123 456').kind).toBe('phone')
    expect(classifyAdminSearch('00359888123456').kind).toBe('phone')
    expect(classifyAdminSearch('888123456').phoneExact).toEqual(expect.arrayContaining(['0888123456', '888123456', '359888123456']))
  })

  it('splits exact email from a prefix', () => {
    expect(classifyAdminSearch('Maria@Example.com')).toMatchObject({ kind: 'email', email: 'maria@example.com', emailExact: true })
    expect(classifyAdminSearch('maria@').emailExact).toBe(false)
  })

  it('reads one to three name tokens in Cyrillic or Latin', () => {
    expect(classifyAdminSearch('Мария').kind).toBe('name')
    expect(classifyAdminSearch('Мария Георгиева Петрова').tokens).toEqual(['Мария', 'Георгиева', 'Петрова'])
    expect(classifyAdminSearch('Maria Petrova').kind).toBe('name')
    expect(classifyAdminSearch('Мария Георгиева Петрова Иванова').kind).toBe('text')
    expect(classifyAdminSearch('М').kind).toBe('text')
  })
})

describe('search SQL', () => {
  it('escapes FTS operators and never splices the raw query into SQL', () => {
    expect(escapeFtsQuery('Иван " OR 1=1 *')).toBe('"Иван"* "OR"* "1=1"*')
    expect(escapeFtsQuery('name:admin AND (drop)')).toBe('"name"* "admin"* "AND"* "drop"*')
    const attack = `"); DROP TABLE signups; --`
    const clause = searchClause(attack)
    expect(clause.clause).not.toContain('DROP')
    expect(clause.clause).not.toContain(attack)
    expect(clause.clause).toContain('MATCH ?')
    expect(clause.binds).toEqual(['";"* "DROP"* "TABLE"* "signups;"* "--"*'])
  })

  it('binds phone, email, and EGN as parameters', () => {
    const phone = searchClause('0888123456')
    expect(phone.clause).toContain('= ?')
    expect(phone.clause).not.toContain('0888123456')
    expect(phone.binds).toContain('0888123456')
    expect(phone.binds).toContain('%888123456')
    const email = searchClause('maria@example.com')
    expect(email).toEqual({ clause: 'lower(email) = ?', binds: ['maria@example.com'] })
    const prefix = searchClause('100%@')
    expect(prefix.clause).toContain("LIKE ? ESCAPE '\\'")
    expect(prefix.binds).toEqual(['100\\%@%'])
    const egn = searchClause('0041010002')
    expect(egn.clause).toContain('egn')
    expect(egn.binds).toEqual(['0041010002'])
  })

  it('matches a name exactly or through the text index', () => {
    const fts = searchClause('Мария')
    expect(fts.clause).toContain("COALESCE(json_extract(payload, '$.firstName'), '') = ?")
    expect(fts.clause).toContain('signup_fts MATCH ?')
    expect(fts.binds).toContain('Мария')
    expect(fts.binds.at(-1)).toBe('"Мария"*')
    const like = searchClause('Мария Петрова', 'like')
    expect(like.clause).not.toContain('signup_fts')
    expect(like.clause).toContain('LIKE ?')
    expect(like.binds).toContain('%Мария%')
  })

  it('falls back to a bound LIKE when the text index is unavailable', () => {
    const clause = searchClause('секция 12%', 'like')
    expect(clause.clause).not.toContain('секция')
    expect(clause.clause).toContain("LIKE ? ESCAPE '\\'")
    expect(clause.binds[0]).toBe('%секция 12\\%%')
  })

  it('keeps an empty query from filtering the roster', () => {
    expect(searchClause('   ')).toEqual({ clause: '1 = 1', binds: [] })
    expect(searchClause('***').clause).toBe('1 = 0')
  })
})

describe('roster URL state', () => {
  it('whitelists sort, view, and page', () => {
    expect(parseSignupSearch({ q: 'Мария', view: 'calls', page: '3', sort: 'email', dir: 'asc' })).toMatchObject({
      q: 'Мария',
      view: 'calls',
      page: 3,
      sort: 'email',
      dir: 'asc',
    })
    expect(parseSignupSearch({ view: 'drop', sort: 'name; DROP', page: -4, dir: 'sideways' })).toMatchObject({
      view: 'all',
      sort: 'updated',
      page: 1,
      dir: 'desc',
    })
    expect(rosterOrder('name', 'asc')).toBe("json_extract(payload, '$.lastName') ASC, json_extract(payload, '$.firstName') ASC")
    expect(rosterOrder('name; DROP TABLE signups', 'desc')).toBe('updated_at DESC')
    expect(rosterOrder('email', 'nope')).toBe('email DESC')
    expect(rosterOrder('flagged', 'desc')).toBe("COALESCE(json_extract(payload, '$.callRequestedAt'), '') DESC")
    expect(rosterOrder('flagged; DROP TABLE signups', 'asc')).toBe('updated_at ASC')
    const days = rosterOrder('days', 'desc')
    expect(days).toContain('rounds_first')
    expect(days).not.toContain('DROP')
    expect(days.endsWith('DESC')).toBe(true)
  })
})

describe('call queue URL', () => {
  it('opens on people still waiting for a call, newest flag first', () => {
    expect(parseQueueSearch({})).toMatchObject({ show: 'open', sort: 'flagged', dir: 'desc', page: 1 })
    expect(parseQueueSearch({ show: 'all', sort: 'days', dir: 'asc', page: '2' })).toMatchObject({
      show: 'all',
      sort: 'days',
      dir: 'asc',
      page: 2,
    })
    expect(parseQueueSearch({ show: 'drop', sort: 'email; DROP', dir: 'sideways' })).toMatchObject({
      show: 'open',
      sort: 'flagged',
      dir: 'desc',
    })
  })
})
