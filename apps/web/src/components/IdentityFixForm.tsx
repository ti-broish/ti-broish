import { useEffect, useState } from 'react'
import { adminChipOn, adminGhost, adminInput } from './admin-ui'
import { formatStaffWhen } from '../signup/admin-progress'
import { identityFixInfo, identityFixSave, type IdentityFixInfo } from '../signup/identity-fix-admin'

const REASONS: Record<string, string> = {
  identity_fix: 'Поправка на име/ЕГН',
  resign_upload: 'Подписано наново (смяна на име)',
}

/**
 * „Поправи име/ЕГН“: names and ЕГН of a numbered person, inline. Saving keeps the number and МИР,
 * moves the signed file to the history and puts the пълномощно back for signing.
 */
export function IdentityFixForm({
  personId,
  taskId,
  onSaved,
  onCancel,
}: {
  personId: string
  taskId?: string | null
  onSaved?: (info: IdentityFixInfo | null, message: string) => void
  onCancel?: () => void
}) {
  const [info, setInfo] = useState<IdentityFixInfo | null>(null)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ firstName: '', middleName: '', lastName: '', egn: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    void identityFixInfo({ data: { personId } })
      .then((result) => {
        if (cancelled) return
        if (!result.ok) return setError(result.message)
        setInfo(result)
        setForm({ firstName: result.firstName, middleName: result.middleName, lastName: result.lastName, egn: '' })
      })
      .catch(() => !cancelled && setError('Данните не се заредиха.'))
    return () => {
      cancelled = true
    }
  }, [personId])

  if (error && !info) return <p className="text-sm font-bold text-[#8a1c1c]" role="alert">{error}</p>
  if (!info) return <p className="text-sm">Зареждаме…</p>
  if (!info.canFix) return <p className="text-sm">Само администратор може да поправя имена и ЕГН.</p>

  const save = () => {
    setSaving(true)
    setError('')
    void identityFixSave({ data: { personId, taskId: taskId ?? null, ...form } })
      .then((result) => {
        if (!result.ok) return setError(result.message)
        if (result.info) setInfo(result.info)
        onSaved?.(result.info, result.message)
      })
      .catch(() => setError('Записът не мина. Опитай пак.'))
      .finally(() => setSaving(false))
  }

  const field = (key: keyof typeof form, label: string, extra?: { placeholder?: string; inputMode?: 'numeric' }) => (
    <label className="grid gap-1 text-sm font-bold" key={key}>
      {label}
      <input
        className={adminInput}
        value={form[key]}
        name={key}
        autoComplete="off"
        placeholder={extra?.placeholder}
        inputMode={extra?.inputMode}
        onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
      />
    </label>
  )

  return (
    <form
      className="grid gap-3 rounded-2xl border-2 border-[#2b062f] bg-[#fbf8fc] p-4"
      aria-label="Поправи име/ЕГН"
      data-testid="identity-fix-form"
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
    >
      <p className="text-sm" data-testid="identity-fix-current">
        Сега: <strong>{[info.firstName, info.middleName, info.lastName].filter(Boolean).join(' ') || '—'}</strong>, ЕГН {info.egnMasked}
        {info.number != null ? `, пълномощно № ${info.mir}/${info.number}` : ''}
        {info.signedAt ? ` (подписано ${formatStaffWhen(info.signedAt)})` : ''}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {field('firstName', 'Име')}
        {field('middleName', 'Презиме')}
        {field('lastName', 'Фамилия')}
      </div>
      {field('egn', 'Ново ЕГН (празно = без промяна)', { placeholder: `сега ${info.egnMasked}`, inputMode: 'numeric' })}
      <p className="text-xs text-[#5c5160]">
        Номерът и МИР остават. Подписаният файл отива в историята (не се трие от Drive), пълномощното се връща в „Само новите“ за ново подписване, а
        качването на подписаното го заменя навсякъде. Задачата остава отворена като „Поправено – чака подпис“.
      </p>
      {error ? (
        <p className="text-sm font-bold text-[#8a1c1c]" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={adminChipOn} disabled={saving}>
          {saving ? 'Записваме…' : 'Запиши и нулирай пълномощното'}
        </button>
        {onCancel ? (
          <button type="button" className={adminGhost} onClick={onCancel}>
            Отказ
          </button>
        ) : null}
      </div>
    </form>
  )
}

/** The person's page: the stage, the superseded files and the „Поправи име/ЕГН“ button. */
export function IdentityFixPanel({ personId, onChanged }: { personId: string; onChanged?: () => void }) {
  const [info, setInfo] = useState<IdentityFixInfo | null>(null)
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    let cancelled = false
    void identityFixInfo({ data: { personId } })
      .then((result) => !cancelled && result.ok && setInfo(result))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [personId, note])

  if (!info || (info.number == null && !info.history.length)) return null
  return (
    <section className="grid gap-2" aria-label="Поправка на име/ЕГН" data-testid="identity-fix-panel">
      <div className="flex flex-wrap items-center gap-2">
        {info.stage ? (
          <span className="rounded-full bg-[#fff3c4] px-3 py-1 text-sm font-bold text-[#5a4300]" data-testid="identity-fix-stage">
            {info.stage}
          </span>
        ) : null}
        {info.canFix && info.number != null && !info.withdrawn && !open ? (
          <button type="button" className={adminGhost} onClick={() => setOpen(true)}>
            Поправи име/ЕГН
          </button>
        ) : null}
      </div>
      {note ? (
        <p className="text-sm font-bold text-[#1d5f2f]" role="status">
          {note}
        </p>
      ) : null}
      {open ? (
        <IdentityFixForm
          personId={personId}
          onCancel={() => setOpen(false)}
          onSaved={(_fresh, message) => {
            setOpen(false)
            setNote(message)
            onChanged?.()
          }}
        />
      ) : null}
      {info.history.length ? (
        <div className="grid gap-1 text-sm" data-testid="identity-fix-history">
          <p className="font-bold">Предишни файлове на пълномощното</p>
          <ul className="grid gap-1">
            {info.history.map((row) => (
              <li key={`${row.supersededAt}-${row.url}`}>
                {formatStaffWhen(row.supersededAt)} · {REASONS[row.reason] ?? row.reason} · {row.supersededBy}:{' '}
                {row.url ? (
                  <a className="underline" href={row.url} target="_blank" rel="noreferrer">
                    стар файл
                  </a>
                ) : (
                  'без файл'
                )}
                {row.replacedUrl ? (
                  <>
                    {' '}
                    → заменен на {row.replacedAt ? formatStaffWhen(row.replacedAt) : ''} с{' '}
                    <a className="underline" href={row.replacedUrl} target="_blank" rel="noreferrer">
                      новия
                    </a>
                  </>
                ) : (
                  ' → чака новия подписан'
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
