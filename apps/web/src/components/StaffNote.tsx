import { updateProfile, useProfile } from '../signup/store'

const field = 'min-h-11 w-full rounded-xl border border-[#ddd] bg-white px-3 py-2'

export function StaffNote() {
  const { profile } = useProfile()
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
          checked={Boolean(profile.callRequestedAt)}
          onChange={(event) =>
            updateProfile({
              callRequestedAt: event.target.checked ? new Date().toISOString() : null,
              callMessage: event.target.checked ? profile.callMessage : '',
            })
          }
        />
        <span>Поискай обаждане от екипа{profile.phone ? ` на ${profile.phone}` : ''}.</span>
      </label>
      {profile.callRequestedAt ? (
        <label className="grid gap-1 text-sm font-semibold">
          За какво е обаждането
          <input
            className={field}
            maxLength={300}
            value={profile.callMessage}
            onChange={(event) => updateProfile({ callMessage: event.target.value })}
          />
        </label>
      ) : null}
      {profile.callRequestedAt ? <p className="text-sm leading-6">Екипът ще ти звънне.</p> : null}
    </div>
  )
}
