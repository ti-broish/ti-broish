import { useState } from 'react'
import { adminGhost, adminChipOn, adminInput } from '../../components/admin-ui'
import { adminBulkUnregister, adminCleanupWithdrawn } from '../../signup/admin-unregister-actions'
import { WITHDRAW_REASONS, WITHDRAW_REASON_LABELS, type WithdrawReason } from '../../signup/admin-unregister'

export function BulkUnregisterBar({
  total,
  visibleCount,
  selectedCount,
  wholeView,
  onWholeView,
  view,
  mir,
  q,
  ids,
  onApplied,
}: {
  total: number
  visibleCount: number
  selectedCount: number
  wholeView: boolean
  onWholeView: () => void
  view: string
  mir: string
  q: string
  ids: string[]
  onApplied: (message: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState<WithdrawReason | ''>('')
  const [note, setNote] = useState('')
  const [open, setOpen] = useState(false)
  const ready = (wholeView || ids.length > 0) && Boolean(reason)
  const showWhole = total > visibleCount

  async function run() {
    if (!reason) {
      onApplied('Избери причина за отписването.')
      return
    }
    setBusy(true)
    try {
      const result = await adminBulkUnregister({
        data: wholeView
          ? { reason, note, scope: 'filter', view, mir, q }
          : { reason, note, scope: 'ids', ids, view, mir, q },
      })
      onApplied(result.ok ? result.message : result.message)
      if (result.ok) {
        setOpen(false)
        setReason('')
        setNote('')
      }
    } catch {
      onApplied('Отписването не мина.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button type="button" className={adminGhost} disabled={busy || (!wholeView && ids.length === 0)} onClick={() => setOpen(true)}>
        Отпиши избраните
      </button>
    )
  }

  return (
    <div className="flex w-full flex-wrap items-end gap-2 rounded-xl border border-[#2b062f] bg-[#f6f1f7] p-3" role="group" aria-label="Групово отписване">
      <p className="w-full text-sm font-bold text-[#1a1020]">{wholeView ? `Целият изглед: ${total}` : `Избрани: ${selectedCount}`}</p>
      {showWhole ? (
        <button type="button" className={wholeView ? adminChipOn : adminGhost} aria-pressed={wholeView} onClick={onWholeView}>
          {wholeView ? 'Само избраните редове' : `Целият изглед (${total})`}
        </button>
      ) : null}
      <label className="grid gap-1 text-sm font-bold text-[#1a1020]">
        Причина
        <select
          className={`${adminInput} min-w-48`}
          value={reason}
          disabled={busy}
          onChange={(event) => setReason(event.target.value as WithdrawReason | '')}
        >
          <option value="">Избери</option>
          {WITHDRAW_REASONS.map((id) => (
            <option key={id} value={id}>
              {WITHDRAW_REASON_LABELS[id]}
            </option>
          ))}
        </select>
      </label>
      <label className="grid min-w-48 flex-1 gap-1 text-sm font-bold text-[#1a1020]">
        Бележка
        <input
          className={adminInput}
          value={note}
          disabled={busy}
          maxLength={400}
          onChange={(event) => setNote(event.target.value)}
          placeholder="По желание"
        />
      </label>
      <button type="button" className={adminGhost} disabled={!ready || busy} onClick={() => void run()}>
        {busy ? 'Отписваме…' : 'Отпиши'}
      </button>
      <button
        type="button"
        className={adminGhost}
        disabled={busy}
        onClick={() => {
          setOpen(false)
          setReason('')
          setNote('')
        }}
      >
        Отказ
      </button>
    </div>
  )
}

/** „Отписани“: frees any seat a withdrawn person still holds and cleans their Brevo contacts. No email. */
export function CleanupWithdrawnButton({ onDone }: { onDone: (message: string) => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <button
        type="button"
        className={adminGhost}
        disabled={busy}
        onClick={() => {
          setBusy(true)
          void adminCleanupWithdrawn()
            .then((result) => onDone(result.message))
            .catch(() => onDone('Почистването не мина. Опитай пак.'))
            .finally(() => setBusy(false))
        }}
      >
        {busy ? 'Почистваме…' : 'Почисти отписаните (секции и Brevo)'}
      </button>
      <span className="text-[#5f5164]">Маха ги от всички списъци в Brevo и изчиства полетата за секция. Без писма.</span>
    </div>
  )
}
