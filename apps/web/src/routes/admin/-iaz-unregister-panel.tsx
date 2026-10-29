import { useState } from 'react'
import { useAdminAccess } from '../../components/AdminShell'
import { adminGhost, adminInput } from '../../components/admin-ui'
import { WITHDRAW_REASONS, WITHDRAW_REASON_LABELS, type WithdrawReason } from '../../signup/admin-unregister'
import { adminPartnerRestore, adminPartnerUnregister } from '../../signup/partner-import-admin'

const field = `${adminInput} w-full`

export interface IazUnregisterPerson {
  id: string
  name: string
  mir: string
  number: string
  sectionDraft: string
  sectionPublished: string
  withdrawnAt: string
  withdrawnBy: string
  withdrawnReason: string
  previousSection: string
}

function when(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('bg-BG', { timeZone: 'Europe/Sofia', dateStyle: 'medium', timeStyle: 'short' })
}

/** „Отпиши“ / „Върни“ for one „И аз“ person, as for a volunteer. Frees the section, keeps the number. No mail, no Brevo. */
export function IazUnregisterPanel({ person, onChanged }: { person: IazUnregisterPerson; onChanged: (message: string) => void }) {
  const canEdit = useAdminAccess().permissions.edit
  const [reason, setReason] = useState<WithdrawReason | ''>('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = (action: () => Promise<{ ok: boolean; message: string }>, failed: string) => {
    setBusy(true)
    setError('')
    void action()
      .then((result) => {
        if (!result.ok) setError(result.message)
        else onChanged(result.message)
      })
      .catch(() => setError(failed))
      .finally(() => setBusy(false))
  }

  if (person.withdrawnAt) {
    return (
      <section className="grid gap-3 rounded-2xl border-2 border-[#3a3140] bg-[#f6f1f7] p-4" aria-labelledby="iaz-unregister-heading">
        <h2 id="iaz-unregister-heading" className="text-lg font-black text-[#1a1020]">
          Отписан
        </h2>
        <p className="text-sm text-[#1a1020]">
          {person.withdrawnReason || 'Отписан'}
          {person.withdrawnBy ? ` · ${person.withdrawnBy}` : ''}
          {` · ${when(person.withdrawnAt)}`}
        </p>
        {person.number ? <p className="text-sm text-[#1a1020]">Пълномощно № {person.mir}/{person.number} остава заето (не се преизползва).</p> : null}
        {person.previousSection ? (
          <p className="text-sm font-bold text-[#1a1020]">Предишна секция: {person.previousSection} (не се връща автоматично)</p>
        ) : null}
        {canEdit ? (
          <div>
            <button type="button" className="brand-button" disabled={busy} onClick={() => run(() => adminPartnerRestore({ data: { id: person.id } }), 'Възстановяването не мина.')}>
              {busy ? 'Връщаме…' : 'Върни'}
            </button>
          </div>
        ) : null}
        {error ? (
          <p className="text-sm font-bold text-[#8f1d1d]" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    )
  }

  const section = person.sectionPublished || person.sectionDraft
  return (
    <section className="grid gap-3 rounded-2xl border-2 border-[#2b062f] bg-white p-4" aria-labelledby="iaz-unregister-heading">
      <h2 id="iaz-unregister-heading" className="text-lg font-black text-[#1a1020]">
        Отпиши
      </h2>
      <p className="text-sm text-[#333]">
        Освобождава секцията и маха човека от активните списъци; ако има пълномощно, номерът му остава зает. Не праща имейл.
      </p>
      <label className="grid gap-1 text-sm font-bold text-[#1a1020]" htmlFor="iaz-withdraw-reason">
        Причина
        <select
          id="iaz-withdraw-reason"
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
      <label className="grid gap-1 text-sm font-bold text-[#1a1020]" htmlFor="iaz-withdraw-note">
        Бележка (по желание)
        <textarea
          id="iaz-withdraw-note"
          className={`${field} min-h-20 py-2`}
          value={note}
          disabled={!canEdit || busy}
          maxLength={400}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      {canEdit ? (
        <div>
          <button
            type="button"
            className={adminGhost}
            disabled={busy || !reason}
            onClick={() => {
              if (!reason) {
                setError('Избери причина за отписването.')
                return
              }
              const what = [section ? `Секция ${section} се освобождава.` : '', person.number ? `Пълномощно № ${person.mir}/${person.number} остава заето.` : '']
                .filter(Boolean)
                .join(' ')
              if (!window.confirm(`Да отпиша ли ${person.name || 'този човек'}? ${what}`.trim())) return
              run(() => adminPartnerUnregister({ data: { id: person.id, reason, note } }), 'Отписването не мина.')
            }}
          >
            {busy ? 'Отписваме…' : 'Отпиши'}
          </button>
        </div>
      ) : (
        <p className="text-sm text-[#333]">Този достъп е само за преглед.</p>
      )}
      {error ? (
        <p className="text-sm font-bold text-[#8f1d1d]" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}
