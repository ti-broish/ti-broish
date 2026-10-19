import { useState } from 'react'
import { adminGhost, adminInput } from '../../components/admin-ui'
import { formatStaffWhen, type AdminPerson } from '../../signup/admin-progress'
import { adminRestorePerson, adminUnregisterPerson } from '../../signup/admin-unregister-actions'
import { WITHDRAW_REASONS, WITHDRAW_REASON_LABELS, withdrawReasonLabel, type WithdrawReason } from '../../signup/admin-unregister'

const field = `${adminInput} w-full`

export function UnregisterPanel({
  person,
  canEdit,
  onChanged,
}: {
  person: AdminPerson
  canEdit: boolean
  onChanged: () => void
}) {
  const [reason, setReason] = useState<WithdrawReason | ''>('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  if (person.withdrawn) {
    return (
      <section className="grid gap-3 rounded-2xl border-2 border-[#3a3140] bg-[#f6f1f7] p-4" aria-labelledby="unregister-heading">
        <h2 id="unregister-heading" className="text-lg font-black text-[#1a1020]">
          Отписан
        </h2>
        <p className="text-sm text-[#1a1020]">
          {person.withdrawnReason ? withdrawReasonLabel(person.withdrawnReason) : 'Отписан от екипа'}
          {person.withdrawnBy ? ` · ${person.withdrawnBy}` : ''}
          {person.withdrawnAt ? ` · ${formatStaffWhen(person.withdrawnAt)}` : ''}
        </p>
        {person.withdrawnNote ? <p className="text-sm text-[#333]">{person.withdrawnNote}</p> : null}
        {person.previousSection ? (
          <p className="text-sm font-bold text-[#1a1020]">
            Предишна секция: {person.previousSection} (не се връща автоматично)
          </p>
        ) : null}
        {canEdit ? (
          <button
            type="button"
            className="brand-button"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              setMessage('')
              setError('')
              void adminRestorePerson({ data: { id: person.id } })
                .then((result) => {
                  if (!result.ok) {
                    setError(result.message)
                    return
                  }
                  setMessage(result.message)
                  onChanged()
                })
                .catch(() => setError('Възстановяването не мина.'))
                .finally(() => setBusy(false))
            }}
          >
            {busy ? 'Връщаме…' : 'Върни'}
          </button>
        ) : null}
        {message ? (
          <p className="text-sm font-bold text-[#145744]" role="status">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className="text-sm font-bold text-[#8f1d1d]" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    )
  }

  return (
    <section className="grid gap-3 rounded-2xl border-2 border-[#2b062f] bg-white p-4" aria-labelledby="unregister-heading">
      <h2 id="unregister-heading" className="text-lg font-black text-[#1a1020]">
        Отпиши
      </h2>
      <p className="text-sm text-[#333]">Освобождава секцията и маха човека от активните списъци. Не праща имейл.</p>
      <label className="grid gap-1 text-sm font-bold text-[#1a1020]" htmlFor="withdraw-reason">
        Причина
        <select
          id="withdraw-reason"
          className={field}
          value={reason}
          disabled={!canEdit || busy}
          onChange={(event) => setReason(event.target.value as WithdrawReason | '')}
          required
        >
          <option value="">Избери причина</option>
          {WITHDRAW_REASONS.map((id) => (
            <option key={id} value={id}>
              {WITHDRAW_REASON_LABELS[id]}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm font-bold text-[#1a1020]" htmlFor="withdraw-note">
        Бележка (по желание)
        <textarea
          id="withdraw-note"
          className={`${field} min-h-20 py-2`}
          value={note}
          disabled={!canEdit || busy}
          maxLength={400}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      {canEdit ? (
        <button
          type="button"
          className={adminGhost}
          disabled={busy || !reason}
          onClick={() => {
            if (!reason) {
              setError('Избери причина за отписването.')
              return
            }
            setBusy(true)
            setMessage('')
            setError('')
            void adminUnregisterPerson({ data: { id: person.id, reason, note } })
              .then((result) => {
                if (!result.ok) {
                  setError(result.message)
                  return
                }
                setMessage(result.message)
                onChanged()
              })
              .catch(() => setError('Отписването не мина.'))
              .finally(() => setBusy(false))
          }}
        >
          {busy ? 'Отписваме…' : 'Отпиши'}
        </button>
      ) : (
        <p className="text-sm text-[#333]">Този достъп е само за преглед.</p>
      )}
      {message ? (
        <p className="text-sm font-bold text-[#145744]" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm font-bold text-[#8f1d1d]" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}
