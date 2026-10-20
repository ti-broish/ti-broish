// One-off: the same „Чернови за „И аз““ plan as Секции → „И аз“ — секции, against a D1 database.
//   pnpm exec tsx scripts/partner-sections.ts --env staging              (dry run)
//   pnpm exec tsx scripts/partner-sections.ts --env production --commit  (writes drafts only)
// Drafts only: never section_published, never a reservation, never mail or Brevo. Prints counts,
// section codes and МИР only: no names, ЕГН, emails or phones.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PARTNER_BLOCKED_SQL,
  PARTNER_PRIORITY_SQL,
  PARTNER_SECTION_PEOPLE_SQL,
  blockedCodes,
  municipalitiesToFetch,
  ordinaryCandidates,
  partnerPersonFrom,
  planPartnerSections,
  priorityCandidates,
  type PriorityRow,
} from '../src/signup/partner-sections'

const args = process.argv.slice(2)
const option = (name: string) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : undefined
}
const target = option('env') ?? 'staging'
const commit = args.includes('--commit')
if (!['staging', 'production', 'local'].includes(target)) {
  console.error('Usage: tsx scripts/partner-sections.ts --env staging|production|local [--commit]')
  process.exit(2)
}
const work = mkdtempSync(join(tmpdir(), 'partner-sections-'))

function wrangler(extra: string[]) {
  const where = target === 'local' ? ['--local'] : ['--remote']
  const env = target === 'production' ? ['--env', 'production'] : []
  return execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'DB', ...env, ...where, ...extra, '--yes'], {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, WRANGLER_LOG_PATH: work },
    maxBuffer: 64 * 1024 * 1024,
  }).toString()
}

function select<T>(sqlText: string): T[] {
  const output = wrangler(['--command', sqlText.replace(/\s+/g, ' '), '--json'])
  const start = output.search(/^\[\s*$/m)
  const parsed = JSON.parse(output.slice(start >= 0 ? start : output.indexOf('['))) as Array<{ results?: T[] }>
  return parsed.flatMap((item) => item.results ?? [])
}

function write(sqlText: string) {
  const path = join(work, 'write.sql')
  writeFileSync(path, sqlText, { mode: 0o600 })
  try {
    wrangler(['--file', path])
  } finally {
    rmSync(path, { force: true })
  }
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'
async function getJson(path: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`https://api.tibroish.bg/${path}`, {
        headers: { Accept: 'application/json', 'Accept-Language': 'bg-BG', 'User-Agent': UA },
        signal: AbortSignal.timeout(20_000),
      })
      if (response.ok) return await response.json()
    } catch {
      // retry
    }
  }
  return null
}

const literal = (value: string) => `'${value.replace(/'/g, "''")}'`

try {
  const people = select<Parameters<typeof partnerPersonFrom>[0]>(PARTNER_SECTION_PEOPLE_SQL).map(partnerPersonFrom)
  const held = select<{ code: string; src: string }>(PARTNER_BLOCKED_SQL)
  const priority = priorityCandidates(select<PriorityRow>(PARTNER_PRIORITY_SQL))
  const blocked = blockedCodes(held)
  const extra = []
  for (const item of municipalitiesToFetch(people, priority, blocked)) {
    const list = await ordinaryCandidates(getJson, item.mir, item.municipality, item.name)
    console.log(`ordinary sections fetched for ${item.mir}:${item.municipality}: ${list.length}`)
    extra.push(...list)
  }
  const plan = planPartnerSections({ people, candidates: [...priority, ...extra], blocked })

  const byMir = new Map<string, { people: number; placed: number; priority: number; local: number; codes: string[]; skipped: Record<string, number> }>()
  for (const person of people) {
    const entry = byMir.get(person.mir || '—') ?? { people: 0, placed: 0, priority: 0, local: 0, codes: [], skipped: {} }
    entry.people += 1
    byMir.set(person.mir || '—', entry)
  }
  for (const row of plan.drafts) {
    const entry = byMir.get(row.mir)!
    entry.placed += 1
    if (row.priority) entry.priority += 1
    if (row.scope !== 'mir') entry.local += 1
    entry.codes.push(`${row.code}${row.priority ? `★R${row.priority.r ?? '—'}` : ''}${row.scope === 'mir' ? '(МИР)' : ''}`)
  }
  for (const row of plan.skipped) {
    const entry = byMir.get(row.mir || '—')!
    entry.skipped[row.reason] = (entry.skipped[row.reason] ?? 0) + 1
  }
  console.log(`${target}: people ${people.length}, held codes ${blocked.size}, priority candidates ${priority.length}, ordinary ${extra.length}`)
  for (const [mir, entry] of [...byMir.entries()].sort()) {
    console.log(
      `МИР ${mir}: ${entry.people} души · чернови ${entry.placed} (приоритетни ${entry.priority}, в общината ${entry.local}) · ${entry.codes.join(', ')}${
        Object.keys(entry.skipped).length ? ` · пропуснати ${JSON.stringify(entry.skipped)}` : ''
      }`,
    )
  }
  const unplaced = plan.skipped.filter((row) => row.reason !== 'has-section').length
  const open = people.filter((person) => !person.draft && !person.published).length
  console.log(`placed ${plan.drafts.length} of ${open} without a section; unplaced ${unplaced}`)

  if (commit) {
    if (open && unplaced / open > 0.3) throw new Error(`Over 30% unplaced (${unplaced}/${open}); not writing.`)
    const now = new Date().toISOString()
    const statements = plan.drafts.map(
      (row) =>
        `UPDATE partner_people SET section_draft = ${literal(row.code)}, section_draft_locked = 0, section_draft_source = 'auto', section_drafted_at = ${literal(now)}, updated_at = ${literal(now)} WHERE id = ${literal(row.personId)} AND COALESCE(section_draft, '') = '' AND COALESCE(section_published, '') = '';`,
    )
    if (statements.length) write(statements.join('\n'))
    const after = select<{ n: number }>(`SELECT COUNT(*) AS n FROM partner_people WHERE COALESCE(section_draft, '') != ''`)
    console.log(`written: partner drafts now ${after[0]?.n ?? 0}`)
  } else {
    console.log('dry run: nothing written')
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
