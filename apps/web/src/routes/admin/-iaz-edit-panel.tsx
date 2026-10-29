import { useEffect, useState } from 'react'
import { useAdminAccess } from '../../components/AdminShell'
import { adminGhost, adminInput } from '../../components/admin-ui'
import { ELECTION_DISTRICTS } from '../../signup/designation-config'
import { adminPartnerHistory, adminPartnerSetMir, adminPartnerUpdate, adminPartnerWithdraw } from '../../signup/partner-import-admin'
import { PARTNER_EDIT_FIELDS, type PartnerEditable } from '../../signup/partner-person-edit'
import { adminPartnerPublish, adminPartnerSave, adminPartnerUnpublish } from '../../signup/partner-sections-admin'

export type IazEditablePerson = PartnerEditable & {
  id: string
  mir: string
  number: string
  sectionDraft: string
  sectionPublished: string
  withdrawnAt: string
}

const card = 'grid gap-3 rounded-2xl border-2 border-[#cfc3d2] bg-white p-4'
const fieldLabel = 'grid gap-1 text-xs font-bold text-[#1a1020]'

function when(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('bg-BG', { timeZone: 'Europe/Sofia', dateStyle: 'medium', timeStyle: 'short' })
}

/** Edit one „И аз“ person: data, МИР (before numbering), section, withdrawal, history. Nothing here sends mail. */
export function IazEditPanel({ person, initialMessage = '', onChanged }: { person: IazEditablePerson; initialMessage?: string; onChanged: (message: string) => void }) {
  const access = useAdminAccess()
  const canEdit = access.permissions.edit
  const canPublish = access.permissions.publish
  const withdrawn = Boolean(person.withdrawnAt)
  const [draft, setDraft] = useState<PartnerEditable>(() => pickEditable(person))
  const [section, setSection] = useState(person.sectionDraft || person.sectionPublished)
  const [mir, setMir] = useState(person.mir)
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState(initialMessage)
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<Array<{ field: string; before: string; after: string; actor: string; at: string }>>([])

  // The page remounts this panel (key) whenever the saved person changes, so state starts fresh.
  useEffect(() => {
    void adminPartnerHistory({ data: { id: person.id } }).then((result) => setHistory(result.ok ? result.rows : []))
  }, [person.id])

  const run = (action: () => Promise<{ ok: boolean; message: string }>) => {
    setBusy(true)
    setMessage('')
    void action()
      .then((result) => {
        setMessage(result.message)
        if (result.ok) onChanged(result.message)
      })
      .catch(() => setMessage('Не се записа. Опитай пак.'))
      .finally(() => setBusy(false))
  }

  const dirty = PARTNER_EDIT_FIELDS.some((field) => draft[field.key] !== (person[field.key] ?? ''))
  const draftChanged = section.trim() !== (person.sectionDraft || person.sectionPublished)
  const canPublishDraft = Boolean(person.sectionDraft) && person.sectionDraft !== person.sectionPublished

  return (
    <section className="grid gap-3" data-testid="iaz-edit">
      <h2 className="text-lg font-black text-[#1a1020]">Редактирай</h2>
      {!canEdit ? <p className="text-sm font-bold text-[#8f1d1d]">Тази роля само гледа.</p> : null}
      {withdrawn ? <p className="text-sm font-bold text-[#7a1f4b]">Оттеглено пълномощно: данните и секцията не се пипат.</p> : null}
      {message ? (
        <p className="rounded-xl border-2 border-[#2b062f] bg-[#f6f1f7] px-3 py-2 text-sm font-bold text-[#1a1020]" role="status" data-testid="iaz-edit-message">
          {message}
        </p>
      ) : null}

      <form
        className={card}
        onSubmit={(event) => {
          event.preventDefault()
          run(() => adminPartnerUpdate({ data: { id: person.id, ...draft } }))
        }}
      >
        <h3 className="font-black text-[#1a1020]">Данни</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          {PARTNER_EDIT_FIELDS.map((field) => (
            <label key={field.key} className={`${fieldLabel} ${field.key === 'placeNote' ? 'sm:col-span-3' : ''}`}>
              {field.label}
              <input
                className={adminInput}
                name={field.key}
                value={draft[field.key]}
                maxLength={field.max}
                disabled={!canEdit || withdrawn || busy}
                required={field.key === 'firstName' || field.key === 'lastName' || field.key === 'email'}
                type={field.key === 'email' ? 'email' : field.key === 'phone' ? 'tel' : 'text'}
                onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
              />
            </label>
          ))}
        </div>
        <p className="text-xs text-[#5c4a63]">Смяна на имената при номерирано пълномощно го връща за подпис (номерът и МИР остават).</p>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={adminGhost} disabled={!canEdit || withdrawn || busy || !dirty}>
            Запази данните
          </button>
          <button type="button" className={adminGhost} disabled={busy || !dirty} onClick={() => setDraft(pickEditable(person))}>
            Откажи
          </button>
        </div>
      </form>

      <div className={card}>
        <h3 className="font-black text-[#1a1020]">МИР и секция</h3>
        {person.number ? (
          <p className="text-sm text-[#1a1020]">МИР {person.mir} (не се сменя след номериране).</p>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <label className={fieldLabel}>
              МИР
              <select className={adminInput} name="mir" value={mir} disabled={!canEdit || withdrawn || busy} onChange={(event) => setMir(event.target.value)}>
                <option value="">—</option>
                {Object.entries(ELECTION_DISTRICTS).map(([code, name]) => (
                  <option key={code} value={code}>
                    {code} {name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={adminGhost}
              disabled={!canEdit || withdrawn || busy || !mir || mir === person.mir}
              onClick={() => run(() => adminPartnerSetMir({ data: { id: person.id, mir } }))}
            >
              Запази МИР
            </button>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <label className={fieldLabel}>
            Секция (чернова, 9 цифри; празно маха черновата)
            <input
              className={adminInput}
              name="section"
              inputMode="numeric"
              value={section}
              maxLength={12}
              disabled={!canEdit || withdrawn || busy}
              onChange={(event) => setSection(event.target.value)}
            />
          </label>
          <button
            type="button"
            className={adminGhost}
            disabled={!canEdit || withdrawn || busy || !draftChanged}
            onClick={() => run(() => adminPartnerSave({ data: { id: person.id, section } }))}
          >
            Запази черновата
          </button>
          <button
            type="button"
            className={adminGhost}
            disabled={!canPublish || withdrawn || busy || !canPublishDraft}
            title="Публикува черновата; номерира пълномощното в МИР на секцията и го слага в „Само новите“ за подпис. Без писма."
            onClick={() => run(() => adminPartnerPublish({ data: { ids: [person.id] } }))}
          >
            Публикувай
          </button>
          <button
            type="button"
            className={adminGhost}
            disabled={!canPublish || withdrawn || busy || !person.sectionPublished}
            onClick={() => run(() => adminPartnerUnpublish({ data: { id: person.id } }))}
          >
            Свали публикуваната
          </button>
        </div>
        <p className="text-xs text-[#5c4a63]">
          Публикувана: {person.sectionPublished || '—'} · Чернова: {person.sectionDraft || '—'}
        </p>
      </div>

      {!withdrawn ? (
        <form
          className={card}
          onSubmit={(event) => {
            event.preventDefault()
            if (!window.confirm('Да оттегля ли това пълномощно? Номерът остава зает.')) return
            run(() => adminPartnerWithdraw({ data: { id: person.id, reason } }))
          }}
        >
          <h3 className="font-black text-[#1a1020]">Оттегли пълномощното</h3>
          <label className={fieldLabel}>
            Причина
            <input className={adminInput} name="reason" value={reason} maxLength={300} disabled={!canPublish || busy} onChange={(event) => setReason(event.target.value)} />
          </label>
          <div>
            <button type="submit" className={adminGhost} disabled={!canPublish || busy || !reason.trim()}>
              Оттегли
            </button>
          </div>
        </form>
      ) : null}

      <div className={card}>
        <h3 className="font-black text-[#1a1020]">История</h3>
        {history.length === 0 ? (
          <p className="text-sm text-[#333]">Няма промени.</p>
        ) : (
          <ul className="grid gap-1 text-sm text-[#1a1020]" data-testid="iaz-history">
            {history.map((row, index) => (
              <li key={`${row.at}-${index}`}>
                {when(row.at)} · {row.actor} · {row.field}: „{row.before}“ → „{row.after}“
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function pickEditable(person: PartnerEditable): PartnerEditable {
  return Object.fromEntries(PARTNER_EDIT_FIELDS.map((field) => [field.key, person[field.key] ?? ''])) as PartnerEditable
}
