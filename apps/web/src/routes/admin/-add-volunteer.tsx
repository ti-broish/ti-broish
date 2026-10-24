import { Link } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'
import { PlacesPicker } from '../../components/PlacesPicker'
import { adminChipOn, adminGhost, adminInput } from '../../components/admin-ui'
import { adminAddVolunteer } from '../../signup/admin'
import type { HomePlace } from '../../signup/model'
import { addVolunteerProblem, parseAddVolunteerInput } from '../../signup/staff-add-volunteer'

type Linked = { kind: 'signup' | 'partner'; id: string; name: string; link: string }

type Outcome =
  | { kind: 'added'; id: string; message: string; placeholder: boolean }
  | { kind: 'duplicate'; message: string; existing: Linked }
  | { kind: 'name-match'; message: string; matches: Linked[] }
  | { kind: 'error'; message: string }

const EMPTY = { firstName: '', middleName: '', lastName: '', egn: '', email: '', phone: '', note: '' }

function RecordLink({ record }: { record: Linked }) {
  const label = record.name || 'Отвори записа'
  return record.kind === 'partner' ? (
    <Link className="font-bold text-[#2b062f] underline" to="/admin/iaz/$personId" params={{ personId: record.id }}>
      {label} („И аз“)
    </Link>
  ) : (
    <Link className="font-bold text-[#2b062f] underline" to="/admin/signups/$personId" params={{ personId: record.id }}>
      {label}
    </Link>
  )
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-sm font-bold text-[#1a1020]" htmlFor={id}>
      {label}
      {children}
      {hint ? <span className="text-xs font-normal text-[#333]">{hint}</span> : null}
    </label>
  )
}

/**
 * „Добави доброволец“: staff add a finished signup for someone who cannot use /signup. Names, ЕГН
 * and the home place are required; e-mail, phone and a note are optional. Nothing is sent.
 */
export function AddVolunteerButton({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [place, setPlace] = useState<HomePlace | null>(null)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  const set = (key: keyof typeof EMPTY) => (event: { target: { value: string } }) => setForm((current) => ({ ...current, [key]: event.target.value }))

  function reset() {
    setForm(EMPTY)
    setPlace(null)
  }

  function submit(allowNameMatch: boolean) {
    const input = { ...form, place, allowNameMatch }
    const problem = addVolunteerProblem(parseAddVolunteerInput(input))
    if (problem) {
      setOutcome({ kind: 'error', message: problem })
      return
    }
    setBusy(true)
    setOutcome(null)
    void adminAddVolunteer({ data: input })
      .then((result) => {
        setBusy(false)
        if (result.ok) {
          setOutcome({ kind: 'added', id: result.id, message: result.message, placeholder: result.placeholder })
          reset()
          onAdded()
          return
        }
        if ('reason' in result && result.reason === 'duplicate') setOutcome({ kind: 'duplicate', message: result.message, existing: result.existing })
        else if ('reason' in result && result.reason === 'name-match') setOutcome({ kind: 'name-match', message: result.message, matches: result.matches })
        else setOutcome({ kind: 'error', message: result.message })
      })
      .catch(() => {
        setBusy(false)
        setOutcome({ kind: 'error', message: 'Записът не мина. Опитай пак.' })
      })
  }

  if (!open) {
    return (
      <button type="button" className={adminChipOn} onClick={() => setOpen(true)}>
        Добави доброволец
      </button>
    )
  }

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby="add-volunteer-title"
      className="grid gap-4 rounded-2xl border-2 border-[#2b062f] bg-white p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid gap-1">
          <h2 id="add-volunteer-title" className="text-lg font-black text-[#1a1020]">
            Добави доброволец
          </h2>
          <p className="max-w-3xl text-sm text-[#333]">
            Записва човека направо като завършил: секция, двата дни, мястото по-долу. Без код по имейл и без писмо до него, нищо не отива в Brevo. Без имейл получава заместител …@tibroish.invalid.
          </p>
        </div>
        <button
          type="button"
          className={adminGhost}
          onClick={() => {
            setOpen(false)
            setOutcome(null)
          }}
        >
          Затвори
        </button>
      </div>
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          submit(false)
        }}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="add-first" label="Име">
            <input id="add-first" className={adminInput} required autoComplete="off" value={form.firstName} onChange={set('firstName')} />
          </Field>
          <Field id="add-middle" label="Презиме">
            <input id="add-middle" className={adminInput} required autoComplete="off" value={form.middleName} onChange={set('middleName')} />
          </Field>
          <Field id="add-last" label="Фамилия">
            <input id="add-last" className={adminInput} required autoComplete="off" value={form.lastName} onChange={set('lastName')} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="add-egn" label="ЕГН">
            <input id="add-egn" className={adminInput} required inputMode="numeric" autoComplete="off" maxLength={10} value={form.egn} onChange={set('egn')} />
          </Field>
          <Field id="add-email" label="Имейл (по желание)" hint="Празно: заместител …@tibroish.invalid.">
            <input id="add-email" className={adminInput} type="email" autoComplete="off" value={form.email} onChange={set('email')} />
          </Field>
          <Field id="add-phone" label="Телефон (по желание)">
            <input id="add-phone" className={adminInput} type="tel" autoComplete="off" value={form.phone} onChange={set('phone')} />
          </Field>
        </div>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-bold text-[#1a1020]">Място (оттук е МИР)</legend>
          <PlacesPicker value={place} onChange={setPlace} sectionLabel="Адрес, ако има предпочитание" footnote="" />
        </fieldset>
        <Field id="add-note" label="Бележка от екипа (по желание)">
          <textarea id="add-note" className={`${adminInput} min-h-20 py-2`} value={form.note} onChange={set('note')} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={adminChipOn} disabled={busy}>
            {busy ? 'Записваме…' : 'Добави като завършил'}
          </button>
        </div>
      </form>
      {outcome ? (
        <div className="grid gap-2 text-sm text-[#1a1020]" role="status" data-testid="add-volunteer-result">
          <p className="font-bold">{outcome.message}</p>
          {outcome.kind === 'added' ? (
            <p>
              <Link className="font-bold text-[#2b062f] underline" to="/admin/signups/$personId" params={{ personId: outcome.id }}>
                Отвори новия запис
              </Link>
              {' · '}Номер получава с „Номерирай“ на{' '}
              <Link className="font-bold text-[#2b062f] underline" to="/admin/palnomoshtni">
                Пълномощни
              </Link>
              .
            </p>
          ) : null}
          {outcome.kind === 'duplicate' ? (
            <p>
              <RecordLink record={outcome.existing} />
            </p>
          ) : null}
          {outcome.kind === 'name-match' ? (
            <>
              <ul className="grid gap-1">
                {outcome.matches.map((match) => (
                  <li key={`${match.kind}:${match.id}`}>
                    <RecordLink record={match} />
                  </li>
                ))}
              </ul>
              <div>
                <button type="button" className={adminGhost} disabled={busy} onClick={() => submit(true)}>
                  Друг човек е, добави въпреки това
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
