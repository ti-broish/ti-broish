// One-off: run the same „И аз“ import (parse → plan → statements) as /admin/palnomoshtni against a D1 database.
//   pnpm exec tsx scripts/partner-import.ts --file ~/iaz.csv --env staging            (dry run)
//   pnpm exec tsx scripts/partner-import.ts --file ~/iaz.csv --env production --commit
// Writes partner_people only, never signups. Sends no mail and does not touch Brevo.
// Prints counts and masked values only. Writes go to wrangler through a 0600 temp file that is
// removed, and wrangler's own debug log is kept in that temp dir too, so no personal data stays behind.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  IAZ_PARTNER,
  IMPORTED_EGNS_SQL,
  SIGNUP_OVERLAP_SQL,
  inlineSql,
  lookupKeys,
  maskEgn,
  parsePartnerCsv,
  partnerImportStatements,
  planPartnerImport,
  planSummary,
  type SignupOverlap,
} from '../src/signup/partner-import'

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(`--${name}`)
const option = (name: string) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : undefined
}

const file = option('file')
const target = option('env') ?? 'staging'
const commit = flag('commit')
if (!file || !['staging', 'production', 'local'].includes(target)) {
  console.error('Usage: tsx scripts/partner-import.ts --file <csv> --env staging|production|local [--commit]')
  process.exit(2)
}

const work = mkdtempSync(join(tmpdir(), 'partner-import-'))

function wrangler(extra: string[]) {
  const where = target === 'local' ? ['--local'] : ['--remote']
  const env = target === 'production' ? ['--env', 'production'] : []
  return execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'DB', ...env, ...where, ...extra, '--yes'], {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, WRANGLER_LOG_PATH: work },
  }).toString()
}

/** Reads go through --command: a remote --file runs as an import and returns no rows. */
function select<T>(sqlText: string): T[] {
  const output = wrangler(['--command', sqlText, '--json'])
  const parsed = JSON.parse(output.slice(output.indexOf('['))) as Array<{ results?: T[] }>
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

function bindLiterals(query: string, values: string[]) {
  let index = 0
  return query.replace(/\?/g, () => `'${String(values[index++]).replace(/'/g, "''")}'`)
}

try {
  const parsed = parsePartnerCsv(readFileSync(file, 'utf8'))
  if (parsed.errors.length) throw new Error(parsed.errors[0])
  const { emails, egns } = lookupKeys(parsed.rows)
  const imported = egns.length
    ? select<{ egn: string }>(bindLiterals(IMPORTED_EGNS_SQL(egns.length), [IAZ_PARTNER, ...egns])).map((row) => row.egn)
    : []
  const signups = select<SignupOverlap>(bindLiterals(SIGNUP_OVERLAP_SQL(emails.length, egns.length), [...emails, ...egns]))
  const plan = planPartnerImport(parsed.rows, imported, signups, IAZ_PARTNER)
  const total = plan.total || 1
  console.log(`[${target}] ${commit ? 'COMMIT' : 'DRY RUN'} · ${planSummary(plan)}`)
  console.log(`  невалидни + дубликати (вече внесени и повторени): ${plan.counts.invalid + plan.counts.already + plan.counts.repeat} от ${plan.total} (${(((plan.counts.invalid + plan.counts.already + plan.counts.repeat) / total) * 100).toFixed(1)}%)`)
  const tally = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1)
  const reasons = new Map<string, number>()
  for (const row of plan.rows) {
    if (row.kind === 'new') continue
    for (const reason of row.reasons) tally(reasons, `${row.kind}: ${reason}`)
    console.log(`  ред ${row.line} · ${row.kind} · ЕГН ${maskEgn(row.person?.egn ?? '') || '—'} · ${row.reasons.join('; ')}`)
  }
  for (const [reason, count] of reasons) console.log(`  ${count} × ${reason}`)
  const warnings = new Map<string, number>()
  for (const row of plan.rows) if (row.kind === 'new') for (const warning of row.person?.warnings ?? []) tally(warnings, warning)
  for (const [warning, count] of warnings) console.log(`  предупреждение (нови): ${count} × ${warning}`)
  const mirs = new Map<string, number>()
  for (const row of plan.rows) if (row.kind === 'new') tally(mirs, row.person?.mir || 'без МИР')
  console.log(`  нови по МИР: ${[...mirs].sort(([a], [b]) => a.localeCompare(b)).map(([mir, count]) => `${mir}: ${count}`).join(', ')}`)
  if (commit) {
    const statements = partnerImportStatements(plan, new Date().toISOString())
    if (statements.length) write(statements.map(inlineSql).join('\n'))
    console.log(`  записани: ${statements.length}`)
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
