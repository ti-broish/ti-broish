import { getCookie } from '@tanstack/react-start/server'
import { env } from 'cloudflare:workers'
import { SESSION_COOKIE, signupDatabase } from './db-core'
import { createDriveClient, tryReadDriveAuth } from './designation-drive-core'
import { OWN_DESIGNATION_FETCH_TIMEOUT_MS, fetchWithTimeout, ownDesignationPdfResponse } from './own-designation'

function workerEnv(): Record<string, string | undefined> {
  return env as unknown as Record<string, string | undefined>
}

/** A one-page PDF for local e2e only: file ids starting with e2e-stub- never reach Drive in `vite dev`. */
function devStubPdf(fileId: string): Uint8Array | null {
  if (!import.meta.env.DEV || !fileId.startsWith('e2e-stub-')) return null
  const body = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj
trailer<</Root 1 0 R>>
%%EOF
% ${fileId}
`
  return new TextEncoder().encode(body)
}

export async function serveOwnDesignationPdf(): Promise<Response> {
  const token = getCookie(SESSION_COOKIE)
  // No session: answer before touching D1.
  if (!token) return ownDesignationPdfResponse({ token, db: null, download: null })
  const db = await signupDatabase()
  const auth = tryReadDriveAuth(workerEnv())
  const client = auth.ok ? createDriveClient(auth.auth, fetchWithTimeout(OWN_DESIGNATION_FETCH_TIMEOUT_MS)) : null
  return ownDesignationPdfResponse({
    token,
    db,
    download: (fileId) => {
      const stub = devStubPdf(fileId)
      if (stub) return Promise.resolve(stub)
      if (!client) return Promise.reject(new Error('Drive credentials missing'))
      return client.downloadFile(fileId)
    },
  })
}
