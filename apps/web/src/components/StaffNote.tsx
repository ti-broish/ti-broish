import { useEffect, useState } from 'react'
import { updateProfile, useProfile } from '../signup/store'

const field = 'min-h-11 w-full rounded-xl border border-[#ddd] bg-white px-3 py-2'

export function StaffNote() {
  const { profile } = useProfile()
  const [asking, setAsking] = useState(Boolean(profile.callRequestedAt))
  useEffect(() => {
    if (profile.callRequestedAt) setAsking(true)
  }, [profile.callRequestedAt])
  const missing = asking && !profile.callMessage.trim()
  return (
    <div className="grid gap-3">
      <label className="grid gap-1 text-sm font-semibold">
        Бележка към екипа
        <textarea
          className={`${field} min-h-28`}
          maxLength={2000}
          value={profile.notes}
          placeholder="Час, кола, достъп или човек, с когото да те свържем."
          onChange={(event) => updateProfile({ notes: event.target.value })}
        />
      </label>
      <label className="flex items-start gap-3 leading-7">
        <input
          type="checkbox"
          className="mt-1"
          checked={asking}
          onChange={(event) => {
            if (!event.target.checked) {
              setAsking(false)
              updateProfile({ callRequestedAt: null, callMessage: '' })
              return
            }
            setAsking(true)
            if (profile.callMessage.trim()) {
              updateProfile({ callRequestedAt: profile.callRequestedAt ?? new Date().toISOString() })
            }
          }}
        />
        <span>Поискай обаждане от екипа{profile.phone ? ` на ${profile.phone}` : ''}.</span>
      </label>
      {asking ? (
        <label className="grid gap-1 text-sm font-semibold">
          За какво е обаждането
          <input
            className={field}
            maxLength={300}
            required
            aria-required="true"
            aria-invalid={missing}
            value={profile.callMessage}
            placeholder="Напиши за какво да ти звъннем."
            onChange={(event) => {
              const callMessage = event.target.value
              updateProfile({
                callMessage,
                callRequestedAt: callMessage.trim() ? (profile.callRequestedAt ?? new Date().toISOString()) : null,
              })
            }}
          />
        </label>
      ) : null}
      {missing ? (
        <p className="text-sm font-bold leading-6 text-[#8f1d1d]" role="alert">
          Напиши за какво е обаждането, за да го поискаш.
        </p>
      ) : null}
      {profile.callRequestedAt && profile.callMessage.trim() ? <p className="text-sm leading-6">Екипът ще ти звънне.</p> : null}
    </div>
  )
}
