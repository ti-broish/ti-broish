import { createContext, useContext, useEffect, useState } from 'react'
import { useAdminAccess } from '../../components/AdminShell'
import { adminGhost } from '../../components/admin-ui'
import { formatStaffWhen } from '../../signup/admin-progress'
import { PROCESSED_LABEL, UNPROCESSED_LABEL, type WithdrawnCounts } from '../../signup/admin-unregister'
import { adminSetWithdrawalProcessed } from '../../signup/admin-unregister-actions'

/** The roster listens here so the counts and a filtered list follow a row's toggle. */
export const WithdrawnCountsContext = createContext<((counts: WithdrawnCounts) => void) | null>(null)

/** „Обработен“ chip and, for editors, the mark/undo button on a withdrawn person. */
export function ProcessedToggle({
  id,
  processedAt,
  processedBy,
  showWho = false,
  onChanged,
}: {
  id: string
  processedAt: string
  processedBy?: string
  showWho?: boolean
  onChanged?: () => void
}) {
  const access = useAdminAccess()
  const onCounts = useContext(WithdrawnCountsContext)
  const [at, setAt] = useState(processedAt)
  const [by, setBy] = useState(processedBy ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    setAt(processedAt)
    setBy(processedBy ?? '')
  }, [processedAt, processedBy])
  const processed = Boolean(at)
  const canEdit = access.permissions.edit
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className={`inline-flex min-h-7 items-center rounded-full px-2 text-xs font-bold ${processed ? 'bg-[#145744] text-white' : 'border border-[#2b062f] bg-[#f4e4b3] text-[#1a1020]'}`}
      >
        {processed ? PROCESSED_LABEL : UNPROCESSED_LABEL}
      </span>
      {showWho && processed ? (
        <span className="text-xs text-[#333]">
          {[by, formatStaffWhen(at)].filter(Boolean).join(' · ')}
        </span>
      ) : null}
      {canEdit ? (
        <button
          type="button"
          className={adminGhost}
          disabled={busy}
          onClick={() => {
            setBusy(true)
            setError('')
            void adminSetWithdrawalProcessed({ data: { id, processed: !processed } })
              .then((result) => {
                if (!result.ok) {
                  setError(result.message)
                  return
                }
                setAt(result.processedAt)
                setBy(result.processedBy)
                onCounts?.(result.counts)
                onChanged?.()
              })
              .catch(() => setError('Промяната не мина.'))
              .finally(() => setBusy(false))
          }}
        >
          {busy ? 'Записваме…' : processed ? 'Махни „обработен“' : 'Обработен'}
        </button>
      ) : null}
      {error ? (
        <span className="text-xs font-bold text-[#8f1d1d]" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  )
}
