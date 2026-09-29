import { useEffect, useState } from 'react'
import { fetchRegions, fetchTowns, type ElectionRegion } from '../signup/geo'
import { radiusOptions, type NamedPlace, type Profile, type TravelStop } from '../signup/model'
import { machineOnlyPlace, needsWiderTravel } from '../signup/rules'
import { updateProfile } from '../signup/store'
import { OblastPicker } from './OblastPicker'

export function useTownDistricts(place: Profile['place']) {
  const [districts, setDistricts] = useState<NamedPlace[]>([])
  const townId = place?.townId
  const municipalityCode = place?.municipalityCode
  const regionCode = place?.regionCode
  useEffect(() => {
    if (!townId || !municipalityCode || regionCode === '32') {
      setDistricts([])
      return
    }
    const regionCodes = regionCode === 'sofia-merged' ? ['23', '24', '25'] : regionCode ? [regionCode] : []
    let cancelled = false
    void fetchTowns({ data: { regionCodes, municipalityCode } })
      .then((towns) => {
        if (cancelled) return
        const town = towns.find((item) => item.id === townId)
        setDistricts((town?.cityRegions ?? []).map((item) => ({ code: item.code, name: item.name })))
      })
      .catch(() => {
        if (!cancelled) setDistricts([])
      })
    return () => {
      cancelled = true
    }
  }, [municipalityCode, regionCode, townId])
  return districts
}

export function TravelChoice({ profile }: { profile: Profile }) {
  const options = radiusOptions(profile.place)
  const [regions, setRegions] = useState<ElectionRegion[]>([])
  const [districtQuery, setDistrictQuery] = useState('')
  const districts = useTownDistricts(profile.place)
  useEffect(() => {
    void fetchRegions()
      .then(setRegions)
      .catch(() => undefined)
  }, [])
  const homeCodes = profile.place?.regionCode === 'sofia-merged' ? ['23', '24', '25'] : profile.place?.regionCode ? [profile.place.regionCode] : []
  const oblastCodes = profile.radius === 'distant' ? profile.distantRegionCodes : profile.radius === 'region' ? homeCodes : []
  const stops = regions
    .filter((region) => oblastCodes.includes(region.code))
    .flatMap((region) => (region.municipalities ?? []).map((item) => ({ regionCode: region.code, regionName: region.name, code: item.code, name: item.name })))
  const others = districts.filter((item) => item.code !== profile.place?.cityRegionCode)
  const needle = districtQuery.trim().toLocaleLowerCase('bg')
  const districtMatches = others.filter((item) => !needle || item.name.toLocaleLowerCase('bg').includes(needle))

  function toggleDistrict(item: NamedPlace) {
    const exists = profile.extraCityRegions.some((region) => region.code === item.code)
    updateProfile({
      radius: 'nearby',
      extraCityRegions: exists ? profile.extraCityRegions.filter((region) => region.code !== item.code) : [...profile.extraCityRegions, item],
    })
  }

  function toggleStop(stop: TravelStop) {
    const exists = profile.travelMunicipalities.some((item) => item.regionCode === stop.regionCode && item.code === stop.code)
    updateProfile({
      travelMunicipalities: exists
        ? profile.travelMunicipalities.filter((item) => !(item.regionCode === stop.regionCode && item.code === stop.code))
        : [...profile.travelMunicipalities, stop],
    })
  }

  return (
    <div className="grid gap-4">
      {machineOnlyPlace(profile.place) ? (
        <p className="rounded-2xl bg-[#fff4d6] px-4 py-3 leading-7">
          На избраното място има само машинни секции. Искаме да пътуваш до хартиена секция.
          {needsWiderTravel(profile.place, profile.radius) ? ' Избери по-широк обхват, за да те разпределим към хартиена.' : ''}
        </p>
      ) : null}
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-semibold">Докъде можеш да стигнеш</legend>
        {options.map((option) => (
          <label key={option.id} className="flex min-h-14 items-center gap-3 rounded-2xl bg-white px-4 py-3 text-lg">
            <input
              type="radio"
              name="radius"
              checked={profile.radius === option.id}
              onChange={() =>
                updateProfile({
                  radius: option.id,
                  extraCityRegions: option.id === 'nearby' ? profile.extraCityRegions : [],
                })
              }
            />
            {option.label}
          </label>
        ))}
      </fieldset>
      {profile.radius === 'nearby' ? (
        <div className="grid gap-3">
          <label className="grid gap-1 text-sm font-semibold">
            Райони наблизо
            <input
              className="min-h-12 w-full rounded-xl border border-[#ddd] bg-white px-3"
              value={districtQuery}
              placeholder="Напиши район"
              onChange={(event) => setDistrictQuery(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {districtMatches.map((item) => {
              const on = profile.extraCityRegions.some((region) => region.code === item.code)
              return (
                <button
                  key={item.code}
                  type="button"
                  className={on ? 'min-h-12 rounded-full bg-[#53c0a4] px-4 font-bold text-[#2b062f]' : 'min-h-12 rounded-full border border-[#ddd] bg-white px-4 font-bold'}
                  onClick={() => toggleDistrict(item)}
                >
                  {item.name}
                </button>
              )
            })}
          </div>
          <p className="text-sm leading-6">Може и от картата: натисни очертан район.</p>
        </div>
      ) : null}
      {profile.radius === 'distant' && profile.place?.regionCode !== '32' ? <OblastPicker profile={profile} /> : null}
      {oblastCodes.some((code) => stops.filter((item) => item.regionCode === code).length > 1) ? (
        <div className="grid gap-3">
          <p className="text-sm font-semibold">Общини. Ако не избереш нито една, остава цялата област.</p>
          {oblastCodes.map((code) => {
            const group = stops.filter((item) => item.regionCode === code)
            if (group.length < 2) return null
            return (
              <div key={code} className="grid gap-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-bold">{group[0]?.regionName}</p>
                  <button
                    type="button"
                    className="font-bold text-[#2b062f]"
                    onClick={() =>
                      updateProfile({
                        travelMunicipalities: profile.travelMunicipalities.filter((item) => item.regionCode !== code),
                      })
                    }
                  >
                    Цялата област
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {group.map((item) => {
                    const on = profile.travelMunicipalities.some((stop) => stop.regionCode === item.regionCode && stop.code === item.code)
                    return (
                      <button
                        key={`${item.regionCode}:${item.code}`}
                        type="button"
                        className={on ? 'min-h-12 rounded-full bg-[#53c0a4] px-4 font-bold text-[#2b062f]' : 'min-h-12 rounded-full border border-[#ddd] bg-white px-4 font-bold'}
                        onClick={() => toggleStop(item)}
                      >
                        {item.name}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
