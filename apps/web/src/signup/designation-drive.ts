import { readFileSync } from 'node:fs'
import { parseServiceAccountJson, readDriveAuth as readDriveAuthCore, type DriveAuth } from './designation-drive-core'

export {
  DRIVE_FILE_SCOPE,
  DRIVE_SCOPE,
  DriveHttpError,
  createDriveClient,
  designationDriveFolderId,
  probeDesignationDriveHealth,
  tryReadDriveAuth,
  withRetry,
  type DriveAuth,
  type DriveAdminClient,
  type DriveClient,
  type DriveFile,
  type DesignationDriveHealth,
} from './designation-drive-core'

function looksLikePath(raw: string) {
  return (raw.endsWith('.json') || raw.startsWith('/') || raw.startsWith('./')) && !raw.trim().startsWith('{')
}

/** CLI-only: a file path is accepted. The Worker core parses JSON only. */
export function parseServiceAccount(raw: string) {
  const text = looksLikePath(raw) ? readFileSync(raw, 'utf8') : raw
  return parseServiceAccountJson(text)
}

export function readDriveAuth(env: Record<string, string | undefined>): DriveAuth {
  const raw = (env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '').trim()
  if (raw && looksLikePath(raw)) {
    return readDriveAuthCore({ ...env, GOOGLE_SERVICE_ACCOUNT_JSON: readFileSync(raw, 'utf8') })
  }
  return readDriveAuthCore(env)
}
