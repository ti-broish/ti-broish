import { useState } from 'react'
import { confirmOwnIdentityChange } from '../signup/db'
import { SELF_CHANGE_CONFIRM, type SelfIdentity } from '../signup/self-identity'
import { updateProfile } from '../signup/store'

export interface IdentityPending {
  requested: SelfIdentity
  stored: SelfIdentity
}

function changes(pending: IdentityPending) {
  const name = (value: SelfIdentity) => [value.firstName, value.middleName, value.lastName].filter(Boolean).join(' ')
  const parts: string[] = []
  if (name(pending.stored) !== name(pending.requested)) parts.push(`имена „${name(pending.stored)}“ → „${name(pending.requested)}“`)
  if (pending.stored.egn !== pending.requested.egn) parts.push('ЕГН')
  return parts.join(' и ')
}

/**
 * A volunteer with a пълномощно changed names or ЕГН: the save kept the old ones until they confirm.
 * „Да, смени“ saves and opens the РИК task for staff; „Не, остави старите“ puts the old ones back.
 */
export function IdentityChangeConfirm({ pending, onDone }: { pending: IdentityPending; onDone: (message: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <div role="alertdialog" aria-labelledby="identity-change-title" className="grid gap-3 rounded-xl border border-amber-400 bg-amber-50 p-4 leading-7" data-testid="identity-change-confirm">
      <p id="identity-change-title" className="font-bold">
        {SELF_CHANGE_CONFIRM}
      </p>
      <p className="text-sm">Промяна: {changes(pending)}. Докато не потвърдиш, остават старите данни.</p>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="brand-button"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            setError('')
            void confirmOwnIdentityChange({ data: pending.requested })
              .then((result) => {
                if (!result.ok) return setError(result.message)
                updateProfile({ firstName: result.identity.firstName, middleName: result.identity.middleName, lastName: result.identity.lastName, egn: result.identity.egn })
                onDone(result.task ? 'Записахме промяната. Екипът ще издаде ново пълномощно и ще поправи данните в РИК.' : '')
              })
              .catch(() => setError('Не се записа. Опитай пак.'))
              .finally(() => setBusy(false))
          }}
        >
          Да, смени
        </button>
        <button
          type="button"
          className="rounded-full border border-[var(--line)] px-4 py-2 font-bold"
          disabled={busy}
          onClick={() => {
            updateProfile({ firstName: pending.stored.firstName, middleName: pending.stored.middleName, lastName: pending.stored.lastName, egn: pending.stored.egn })
            onDone('')
          }}
        >
          Не, остави старите
        </button>
      </div>
    </div>
  )
}
