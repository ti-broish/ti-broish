import { describe, expect, it } from 'vitest'
import { parseSectionSearch } from './admin-search'
import { CLEAR_AUTO_DRAFTS_SQL, RERUN_CLEAR_AUTO_DRAFTS_SQL, RERUN_WRITE_DRAFT_SQL } from './distribute-rerun-sql'
import {
  SECTION_STATE_SQL,
  hasPendingDraft,
  pickedIds,
  sectionCountsFrom,
  sectionCountsSql,
  sectionStateOf,
  unpublishSql,
  withPickedIds,
} from './section-state'

type Raw = {
  exec: (sql: string) => void
  prepare: (sql: string) => { run: (...a: unknown[]) => { changes: number | bigint }; get: (...a: unknown[]) => unknown; all: (...a: unknown[]) => unknown[] }
}

async function openDb(): Promise<Raw | null> {
  try {
    const mod = (await import(/* @vite-ignore */ 'node:sqlite')) as { DatabaseSync: new (path: string) => Raw }
    const raw = new mod.DatabaseSync(':memory:')
    raw.exec(`CREATE TABLE signups (id TEXT PRIMARY KEY, role TEXT DEFAULT 'section', submitted INTEGER DEFAULT 1, withdrawn INTEGER DEFAULT 0,
      draft_section TEXT, draft_locked INTEGER DEFAULT 0, published_section TEXT, published_at TEXT, updated_at TEXT,
      region_code TEXT DEFAULT '23', mir_code TEXT DEFAULT '23')`)
    return raw
  } catch {
    return null
  }
}

function seed(raw: Raw) {
  const rows: Array<[string, string | null, number, string | null, number]> = [
    // id, draft, locked, published, withdrawn
    ['none', null, 0, null, 0],
    ['auto', '010100001', 0, null, 0],
    ['manual', '010100002', 1, null, 0],
    ['published', '010100003', 0, '010100003', 0],
    ['published-change', '010100009', 1, '010100004', 0],
    ['withdrawn', '010100005', 0, null, 1],
  ]
  for (const [id, draft, locked, published, withdrawn] of rows) {
    raw.prepare('INSERT INTO signups (id, draft_section, draft_locked, published_section, withdrawn) VALUES (?, ?, ?, ?, ?)').run(id, draft, locked, published, withdrawn)
  }
}

const snapshot = (raw: Raw) => raw.prepare('SELECT id, draft_section, draft_locked, published_section FROM signups ORDER BY id').all()

describe('section states', () => {
  it('puts every person in exactly one of none / draft / published', () => {
    expect(sectionStateOf({ draftSection: '', publishedSection: '' })).toBe('none')
    expect(sectionStateOf({ draftSection: '010100001', publishedSection: '' })).toBe('draft')
    expect(sectionStateOf({ draftSection: '010100001', publishedSection: '010100001' })).toBe('published')
    expect(sectionStateOf({ draftSection: '010100009', publishedSection: '010100004' })).toBe('published')
    expect(hasPendingDraft({ draftSection: '010100009', publishedSection: '010100004' })).toBe(true)
    expect(hasPendingDraft({ draftSection: '010100003', publishedSection: '010100003' })).toBe(false)
    expect(hasPendingDraft({ draftSection: '', publishedSection: '' })).toBe(false)
  })

  it('SQL states and counts: „Чернова“ is every pending draft, incl. a change next to a published section', async () => {
    const raw = await openDb()
    if (!raw) return
    seed(raw)
    const ids = (state: keyof typeof SECTION_STATE_SQL) =>
      (raw.prepare(`SELECT id FROM signups WHERE withdrawn = 0 AND ${SECTION_STATE_SQL[state]} ORDER BY id`).all() as Array<{ id: string }>).map((row) => row.id)
    expect(ids('none')).toEqual(['none'])
    // A published person with a different draft is a pending change: in „Чернова“ and still in „Публикувани“.
    expect(ids('draft')).toEqual(['auto', 'manual', 'published-change'])
    expect(ids('draft').every((id) => {
      const row = raw.prepare('SELECT draft_section, published_section FROM signups WHERE id = ?').get(id) as { draft_section: string | null; published_section: string | null }
      return hasPendingDraft({ draftSection: row.draft_section ?? '', publishedSection: row.published_section ?? '' })
    })).toBe(true)
    expect(ids('published')).toEqual(['published', 'published-change'])
    expect(sectionCountsFrom(raw.prepare(sectionCountsSql('withdrawn = 0')).get() as Record<string, unknown>)).toEqual({ total: 5, none: 1, draft: 3, published: 2 })
  })

  it('parses old view=unassigned/draft/assigned links into state', () => {
    expect(parseSectionSearch({ view: 'draft' })).toEqual({ q: '', view: 'all', mir: '', state: 'draft' })
    expect(parseSectionSearch({ view: 'assigned' })).toEqual({ q: '', view: 'all', mir: '', state: 'published' })
    expect(parseSectionSearch({ view: 'mir', mir: '23', state: 'none' })).toEqual({ q: '', view: 'mir', mir: '23', state: 'none' })
    expect(parseSectionSearch({ state: 'bogus' })).toEqual({ q: '', view: 'all', mir: '' })
  })
})

describe('publish picked ids', () => {
  it('cleans ids and narrows the filter with one JSON bind', async () => {
    expect(pickedIds(['a', ' a ', 3, '', 'b'])).toEqual(['a', 'b'])
    expect(pickedIds('a')).toEqual([])
    expect(withPickedIds({ clause: '1 = 1', binds: [] }, undefined)).toEqual({ clause: '1 = 1', binds: [] })
    expect(withPickedIds({ error: 'x' }, ['a'])).toEqual({ error: 'x' })
    const narrowed = withPickedIds({ clause: 'withdrawn = 0', binds: [] as unknown[] }, Array.from({ length: 300 }, (_, i) => `id-${i}`))
    expect(narrowed.binds).toHaveLength(1)
    const raw = await openDb()
    if (!raw) return
    seed(raw)
    const picked = withPickedIds({ clause: 'withdrawn = 0', binds: [] as unknown[] }, ['auto', 'withdrawn', 'nope'])
    expect(raw.prepare(`SELECT id FROM signups WHERE ${picked.clause}`).all(...(picked.binds as string[]))).toEqual([{ id: 'auto' }])
    // An empty pick publishes nobody, not the whole view.
    const empty = withPickedIds({ clause: '1 = 1', binds: [] as unknown[] }, [])
    expect(raw.prepare(`SELECT id FROM signups WHERE ${empty.clause}`).all(...(empty.binds as string[]))).toEqual([])
  })
})

describe('unpublish', () => {
  it('keeps the section as a manual draft, or keeps a pending change as the draft', async () => {
    const raw = await openDb()
    if (!raw) return
    seed(raw)
    raw.prepare('UPDATE signups SET draft_section = NULL WHERE id = ?').run('published')
    raw.prepare(unpublishSql(true)).run('now', 'published')
    raw.prepare(unpublishSql(false)).run('now', 'published-change')
    expect(raw.prepare(unpublishSql(false)).run('now', 'auto').changes).toBe(0)
    const rows = snapshot(raw) as Array<{ id: string }>
    expect(rows.find((row) => row.id === 'published')).toEqual({ id: 'published', draft_section: '010100003', draft_locked: 1, published_section: null })
    expect(rows.find((row) => row.id === 'published-change')).toEqual({ id: 'published-change', draft_section: '010100009', draft_locked: 1, published_section: null })
  })
})

describe('auto-allocation rerun', () => {
  it('writes an automatic draft for a mobile-team volunteer too, never for video or an unpicked role', async () => {
    const raw = await openDb()
    if (!raw) return
    seed(raw)
    for (const [id, role] of [['mob', 'mobile'], ['vid', 'video'], ['blank', '']]) {
      raw.prepare("INSERT INTO signups (id, role, submitted, withdrawn, draft_locked) VALUES (?, ?, 1, 0, 0)").run(id, role)
      raw.prepare(RERUN_WRITE_DRAFT_SQL).run('020200007', 'now', id, 0)
    }
    const rows = raw.prepare("SELECT id, draft_section FROM signups WHERE id IN ('mob', 'vid', 'blank') ORDER BY id").all()
    expect(rows).toEqual([{ id: 'blank', draft_section: null }, { id: 'mob', draft_section: '020200007' }, { id: 'vid', draft_section: null }])
  })

  it('only touches automatic drafts of people with no published section', async () => {
    const raw = await openDb()
    if (!raw) return
    seed(raw)
    const before = snapshot(raw) as Array<{ id: string }>
    raw.prepare(RERUN_CLEAR_AUTO_DRAFTS_SQL).run('now')
    for (const id of ['none', 'auto', 'manual', 'published', 'published-change', 'withdrawn']) raw.prepare(RERUN_WRITE_DRAFT_SQL).run('020200002', 'now', id, 0)
    const after = snapshot(raw) as Array<{ id: string; draft_section: string | null }>
    const changed = after.filter((row, i) => JSON.stringify(row) !== JSON.stringify(before[i])).map((row) => row.id)
    expect(changed).toEqual(['auto', 'none'])
    for (const id of ['manual', 'published', 'published-change', 'withdrawn']) {
      expect(after.find((row) => row.id === id)).toEqual(before.find((row) => row.id === id))
    }
  })

  it('a country rerun keeps the abroad allocator drafts', async () => {
    const raw = await openDb()
    if (!raw) return
    raw.prepare(`INSERT INTO signups (id, draft_section, region_code, mir_code) VALUES ('abroad', '320100001', '32', '32')`).run()
    raw.prepare(RERUN_CLEAR_AUTO_DRAFTS_SQL).run('now')
    expect(snapshot(raw)).toEqual([{ id: 'abroad', draft_section: '320100001', draft_locked: 0, published_section: null }])
  })

  it('„Изчисти черновите“ removes only automatic drafts, in the country and abroad', async () => {
    const raw = await openDb()
    if (!raw) return
    seed(raw)
    raw.prepare(`INSERT INTO signups (id, draft_section, region_code, mir_code) VALUES ('abroad', '320100001', '32', '32')`).run()
    const before = snapshot(raw) as Array<{ id: string }>
    raw.prepare(CLEAR_AUTO_DRAFTS_SQL).run('now')
    const after = snapshot(raw) as Array<{ id: string; draft_section: string | null }>
    const changed = after.filter((row, i) => JSON.stringify(row) !== JSON.stringify(before[i])).map((row) => row.id)
    // withdrawn has an automatic draft too; withdrawal frees seats, so dropping it is harmless.
    expect(changed).toEqual(['abroad', 'auto', 'withdrawn'])
    for (const id of ['manual', 'published', 'published-change', 'none']) {
      expect(after.find((row) => row.id === id)).toEqual(before.find((row) => row.id === id))
    }
  })

  it('onlyEmpty keeps every existing draft', async () => {
    const raw = await openDb()
    if (!raw) return
    seed(raw)
    for (const id of ['none', 'auto']) raw.prepare(RERUN_WRITE_DRAFT_SQL).run('020200002', 'now', id, 1)
    const rows = snapshot(raw) as Array<{ id: string; draft_section: string | null }>
    expect(rows.find((row) => row.id === 'auto')?.draft_section).toBe('010100001')
    expect(rows.find((row) => row.id === 'none')?.draft_section).toBe('020200002')
  })
})
