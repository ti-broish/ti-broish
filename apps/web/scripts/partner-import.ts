// One-off: run the same partner import (parse → plan → statements) as the admin page against a D1 database.
//   pnpm exec tsx scripts/partner-import.ts --file /tmp/iaz.csv --env staging            (dry run)
//   pnpm exec tsx scripts/partner-import.ts --file /tmp/iaz.csv --env production --commit
// Prints counts and masked values only. Personal data goes to wrangler through 0600 temp files that are removed.
// Sends no mail and does not touch Brevo.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  EXISTING_SIGNUPS_SQL,
  IAZ_PARTNER,
  inlineSql,
  lookupKeys,
  maskEgn,
  maskEmail,
  parsePartnerCsv,
  partnerImportStatements,
  planPartnerImport,
  planSummary,
  type ExistingSignup,
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

function wrangler(sqlText: string, json: boolean) {
  const path = join(work, `q-${Date.now()}.sql`)
  writeFileSync(path, sqlText, { mode: 0o600 })
  try {
    const where = target === 'local' ? ['--local'] : ['--remote']
    const env = target === 'production' ? ['--env', 'production'] : []
    const output = execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'DB', ...env, ...where, '--file', path, ...(json ? ['--json'] : []), '--yes'], {
      cwd: new URL('..', import.meta.url).pathname,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CLOUDFLARE_ENV: target === 'production' ? 'production' : '' },
    }).toString()
    return output
  } finally {
    rmSync(path, { force: true })
  }
}

function literal(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

try {
  const parsed = parsePartnerCsv(readFileSync(file, 'utf8'))
  if (parsed.errors.length) throw new Error(parsed.errors[0])
  const { emails, egns } = lookupKeys(parsed.rows)
  const query = EXISTING_SIGNUPS_SQL(emails.length, egns.length)
  let index = 0
  const values = [...emails, ...egns]
  const select = query.replace(/\?/g, () => literal(values[index++]!))
  const result = JSON.parse(wrangler(`${select};`, true)) as Array<{ results?: ExistingSignup[] }>
  const existing = result.flatMap((item) => item.results ?? [])
  const plan = planPartnerImport(parsed.rows, existing, IAZ_PARTNER)
  console.log(`[${target}] ${commit ? 'COMMIT' : 'DRY RUN'} · ${planSummary(plan)}`)
  const reasons = new Map<string, number>()
  for (const row of plan.rows) {
    if (row.kind === 'invalid' || row.kind === 'repeat' || row.kind === 'tag' || row.kind === 'already') {
      for (const reason of row.reasons) reasons.set(`${row.kind}: ${reason}`, (reasons.get(`${row.kind}: ${reason}`) ?? 0) + 1)
      console.log(`  ред ${row.line} · ${row.kind} · ${maskEmail(row.email)} · ЕГН ${maskEgn(row.person?.egn ?? '') || '—'} · ${row.reasons.join('; ')}`)
    }
  }
  for (const [reason, count] of reasons) console.log(`  ${count} × ${reason}`)
  const warnings = new Map<string, number>()
  for (const row of plan.rows) for (const warning of row.person?.warnings ?? []) warnings.set(warning, (warnings.get(warning) ?? 0) + 1)
  for (const [warning, count] of warnings) console.log(`  предупреждение: ${count} × ${warning}`)
  const mapped = plan.rows.filter((row) => row.kind === 'new' && row.person)
  console.log(`  място: с община ${mapped.filter((row) => row.person?.place?.municipalityCode).length}, само област ${mapped.filter((row) => row.person?.place && !row.person.place.municipalityCode).length}, без място ${mapped.filter((row) => !row.person?.place).length}, с МИР ${mapped.filter((row) => row.person?.place && row.person.place.regionCode !== 'sofia-merged' || row.person?.place?.cityRegionName).length}`)
  if (commit) {
    const statements = partnerImportStatements(plan, new Date().toISOString())
    if (statements.length) {
      wrangler(statements.map(inlineSql).join('\n'), true)
    }
    console.log(`  записани заявки: ${statements.length}`)
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
