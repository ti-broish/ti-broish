import { EXPERIENCE, placeLabel, radiusOptions, roleLabel, type Companion, type Profile } from '../signup/model'

export function profileFacts(profile: Profile): { label: string; value: string }[] {
  return [
    { label: 'Име', value: fullName(profile) },
    { label: 'Имейл', value: profile.email.trim() || 'Липсва' },
    { label: 'Телефон', value: profile.phone.trim() || 'Липсва' },
    { label: 'Роля', value: profile.role ? roleLabel(profile.role, profile.mobileTeam) : 'Още не е избрана' },
    { label: 'Дни', value: daysValue(profile) },
    { label: 'Място', value: placeLabel(profile.place) },
    { label: 'Пътуване', value: travelValue(profile) },
    { label: 'Опит', value: EXPERIENCE.find((item) => item.id === profile.experience)?.title ?? 'Още не е избран' },
    { label: 'Група', value: groupValue(profile) },
    { label: 'ЕГН', value: profile.egn.trim() ? 'Въведено' : 'Липсва' },
  ]
}

export function ProfileSummary({ profile }: { profile: Profile }) {
  return (
    <section className="grid gap-3" aria-label="Твоите данни">
      <h2 className="text-xl font-black text-[#444]">Твоите данни</h2>
      <dl className="rounded-2xl border border-[var(--line)] bg-white px-4">
        {profileFacts(profile).map((fact) => (
          <div key={fact.label} className="grid gap-0.5 border-b border-[var(--line)] py-3 last:border-b-0 sm:grid-cols-[8.5rem_1fr] sm:items-baseline sm:gap-3">
            <dt className="text-sm font-bold text-[#666]">{fact.label}</dt>
            <dd className="leading-6">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function fullName(profile: Profile) {
  const name = [profile.firstName, profile.middleName, profile.lastName].map((part) => part.trim()).filter(Boolean).join(' ')
  return name || 'Липсва'
}

function daysValue(profile: Profile) {
  const days = [profile.rounds.first ? '25 октомври' : '', profile.rounds.runoff ? '1 ноември' : ''].filter(Boolean)
  return days.length > 0 ? days.join(' и ') : 'Няма избран ден'
}

function travelValue(profile: Profile) {
  if (profile.role === 'video') return 'От вкъщи'
  const radius = radiusOptions(profile.place).find((item) => item.id === profile.radius)?.label
  const extras = [
    profile.extraCityRegions.map((region) => region.name).join(', '),
    profile.travelMunicipalities.map((stop) => stop.name).join(', '),
    ...vehicleNotes(profile),
  ].filter(Boolean)
  if (!radius && extras.length === 0) return 'Още не е избрано'
  return [radius, ...extras].filter(Boolean).join(' · ')
}

function vehicleNotes(profile: Profile) {
  if (profile.role === 'mobile') {
    const car = profile.hasCar === true ? (profile.carSeats > 0 ? `кола, ${profile.carSeats} места` : 'кола') : profile.hasCar === false ? 'без кола' : ''
    const drone = profile.hasDrone === true ? 'има дрон' : profile.hasDrone === false ? 'без дрон' : ''
    return [car, drone]
  }
  return profile.carSeats > 0 ? [`${profile.carSeats} свободни места`] : []
}

function groupValue(profile: Profile) {
  const group = profile.companions.filter((person) => person.inGroup !== false)
  const outside = profile.companions.filter((person) => person.inGroup === false)
  if (group.length === 0 && outside.length === 0) return 'Без група'
  const parts = [group.length === 0 ? 'Без група' : group.map(personName).join(', ')]
  if (outside.length > 0) parts.push(`като координатор: ${outside.map(personName).join(', ')}`)
  return parts.join(' · ')
}

function personName(person: Companion) {
  return `${person.firstName} ${person.lastName}`.trim()
}
