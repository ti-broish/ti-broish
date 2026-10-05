import { useEffect, useMemo, useState } from 'react'
import { fetchRegions, type ElectionRegion } from '../signup/geo'
import { radiusOptions, type HomePlace, type NamedPlace, type Radius, type TravelStop } from '../signup/model'
import { OBLASTS } from '../signup/oblasts'
import { machineOnlyPlace, needsWiderTravel } from '../signup/rules'
import { useTownDistricts } from './TravelChoice'

export interface StaffTravelValue {
  radius: Radius
  extraCityRegions: NamedPlace[]
  distantRegionCodes: string[]
  travelMunicipalities: TravelStop[]
}

export function StaffTravel({
  place,
  radius,
  extraCityRegions,
  distantRegionCodes,
  travelMunicipalities,
  onChange,
}: {
  place: HomePlace | null
  radius: Radius | null
  extraCityRegions: NamedPlace[]
  distantRegionCodes: string[]
  travelMunicipalities: TravelStop[]
  onChange: (next: StaffTravelValue) => void
}) {
  const options = radiusOptions(place)
  const districts = useTownDistricts(place)
  const [regions, setRegions] = useState<ElectionRegion[]>([])
  const [districtQuery, setDistrictQuery] = useState('')
  const [oblastQuery, setOblastQuery] = useState('')
  const [oblastOpen, setOblastOpen] = useState(false)

  useEffect(() => {
    void fetchRegions()
      .then(setRegions)
      .catch(() => undefined)
  }, [])

  const homeKey = place?.regionCode ?? ''
  const homeCodes = homeKey === 'sofia-merged' ? ['23', '24', '25'] : homeKey ? [homeKey] : []
  const home = useMemo(() => new Set(homeKey === 'sofia-merged' ? ['23', '24', '25'] : homeKey ? [homeKey] : []), [homeKey])
  const oblastCodes = radius === 'distant' ? distantRegionCodes : radius === 'region' ? homeCodes : []
  const stops = regions
    .filter((region) => oblastCodes.includes(region.code))
    .flatMap((region) => (region.municipalities ?? []).map((item) => ({ regionCode: region.code, regionName: region.name, code: item.code, name: item.name })))
  const others = districts.filter((item) => item.code !== place?.cityRegionCode)
  const districtNeedle = districtQuery.trim().toLocaleLowerCase('bg')
  const districtMatches = others.filter((item) => !districtNeedle || item.name.toLocaleLowerCase('bg').includes(districtNeedle))
  const oblastChoices = OBLASTS.filter((oblast) => !oblast.regionCodes.some((code) => home.has(code)))
  const selectedOblasts = oblastChoices.filter((oblast) => oblast.regionCodes.some((code) => distantRegionCodes.includes(code)))
  const oblastNeedle = oblastQuery.trim().toLocaleLowerCase('bg')
  const oblastMatches = oblastChoices
    .filter((oblast) => !selectedOblasts.some((item) => item.id === oblast.id))
    .filter((oblast) => !oblastNeedle || oblast.name.toLocaleLowerCase('bg').includes(oblastNeedle))
    .slice(0, 8)

  function commit(next: Partial<StaffTravelValue> & { radius: Radius }) {
    onChange({
      radius: next.radius,
      extraCityRegions: next.extraCityRegions ?? extraCityRegions,
      distantRegionCodes: next.distantRegionCodes ?? distantRegionCodes,
      travelMunicipalities: next.travelMunicipalities ?? travelMunicipalities,
    })
  }

  function chooseRadius(id: Radius) {
    commit({ radius: id, extraCityRegions: id === 'nearby' ? extraCityRegions : [] })
  }

  function toggleDistrict(item: NamedPlace) {
    const exists = extraCityRegions.some((region) => region.code === item.code)
    commit({
      radius: 'nearby',
      extraCityRegions: exists ? extraCityRegions.filter((region) => region.code !== item.code) : [...extraCityRegions, item],
    })
  }

  function toggleCode(code: string) {
    if (!code || home.has(code)) return
    const exists = distantRegionCodes.includes(code)
    commit({
      radius: 'distant',
      distantRegionCodes: exists ? distantRegionCodes.filter((item) => item !== code) : [...distantRegionCodes, code],
    })
  }

  function toggleStop(stop: TravelStop) {
    if (!radius) return
    const exists = travelMunicipalities.some((item) => item.regionCode === stop.regionCode && item.code === stop.code)
    commit({
      radius,
      travelMunicipalities: exists
        ? travelMunicipalities.filter((item) => !(item.regionCode === stop.regionCode && item.code === stop.code))
        : [...travelMunicipalities, stop],
    })
  }

  if (options.length === 0) {
    return <p className="text-sm text-[#333]">Няма избрано място, затова обхватът не може да се смени.</p>
  }

  return (
    <div className="grid gap-3">
      <p className="text-sm font-bold text-[#1a1020]">Докъде може да стигне</p>
      {machineOnlyPlace(place) ? (
        <p className="rounded-xl bg-[#fff4d6] px-3 py-2 text-sm leading-6 text-[#1a1020]">
          На адреса има само машинни секции. За хартиена секция трябва по-широк обхват.
          {needsWiderTravel(place, radius) ? ' Сегашният обхват е твърде тесен.' : ''}
        </p>
      ) : null}
      <div className="grid gap-2" role="radiogroup" aria-label="Докъде може да стигне">
        {options.map((option) => (
          <label key={option.id} className="flex min-h-11 items-center gap-3 text-sm text-[#1a1020]">
            <input type="radio" name="staff-radius" className="h-5 w-5" checked={radius === option.id} onChange={() => chooseRadius(option.id)} />
            {option.label}
          </label>
        ))}
      </div>
      {radius === 'nearby' ? (
        <div className="grid gap-2">
          <label className="grid gap-1 text-sm font-bold text-[#1a1020]">
            Райони наблизо
            <input
              className="min-h-11 w-full rounded-xl border-2 border-[#2b062f] bg-white px-3 text-[#1a1020]"
              value={districtQuery}
              placeholder="Напиши район"
              onChange={(event) => setDistrictQuery(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {districtMatches.map((item) => {
              const on = extraCityRegions.some((region) => region.code === item.code)
              return (
                <button
                  key={item.code}
                  type="button"
                  className={on ? 'min-h-11 rounded-full bg-[#53c0a4] px-4 text-sm font-bold text-[#2b062f]' : 'min-h-11 rounded-full border-2 border-[#2b062f] bg-white px-4 text-sm font-bold text-[#1a1020]'}
                  onClick={() => toggleDistrict(item)}
                >
                  {item.name}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
      {radius === 'distant' && place?.regionCode !== '32' ? (
        <div className="grid gap-2">
          <label className="grid gap-1 text-sm font-bold text-[#1a1020]">
            Други области
            <input
              className="min-h-11 w-full rounded-xl border-2 border-[#2b062f] bg-white px-3 text-[#1a1020]"
              value={oblastQuery}
              placeholder="Напиши област"
              role="combobox"
              aria-expanded={oblastOpen}
              onFocus={() => setOblastOpen(true)}
              onChange={(event) => {
                setOblastQuery(event.target.value)
                setOblastOpen(true)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  toggleCode(oblastMatches[0]?.regionCodes[0] ?? '')
                  setOblastQuery('')
                  setOblastOpen(false)
                }
                if (event.key === 'Escape') setOblastOpen(false)
              }}
            />
          </label>
          {oblastOpen && oblastMatches.length > 0 ? (
            <ul className="grid overflow-hidden rounded-xl border-2 border-[#2b062f] bg-white">
              {oblastMatches.map((oblast) => (
                <li key={oblast.id}>
                  <button
                    type="button"
                    className="min-h-11 w-full px-3 text-left text-sm font-bold text-[#1a1020]"
                    onClick={() => {
                      toggleCode(oblast.regionCodes[0] ?? '')
                      setOblastQuery('')
                      setOblastOpen(false)
                    }}
                  >
                    {oblast.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <ul className="flex flex-wrap gap-2">
            {selectedOblasts.map((oblast) => (
              <li key={oblast.id}>
                <button
                  type="button"
                  className="min-h-11 rounded-full bg-[#53c0a4] px-4 text-sm font-bold text-[#2b062f]"
                  onClick={() => toggleCode(oblast.regionCodes[0] ?? '')}
                >
                  {oblast.name} ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {oblastCodes.some((code) => stops.filter((item) => item.regionCode === code).length > 1) ? (
        <div className="grid gap-3">
          <p className="text-sm font-bold text-[#1a1020]">Общини. Ако не избереш нито една, остава цялата област.</p>
          {oblastCodes.map((code) => {
            const group = stops.filter((item) => item.regionCode === code)
            if (group.length < 2) return null
            return (
              <div key={code} className="grid gap-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-bold text-[#1a1020]">{group[0]?.regionName}</p>
                  <button
                    type="button"
                    className="text-sm font-bold text-[#2b062f]"
                    onClick={() => {
                      if (!radius) return
                      commit({ radius, travelMunicipalities: travelMunicipalities.filter((item) => item.regionCode !== code) })
                    }}
                  >
                    Цялата област
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {group.map((item) => {
                    const on = travelMunicipalities.some((stop) => stop.regionCode === item.regionCode && stop.code === item.code)
                    return (
                      <button
                        key={`${item.regionCode}:${item.code}`}
                        type="button"
                        className={on ? 'min-h-11 rounded-full bg-[#53c0a4] px-4 text-sm font-bold text-[#2b062f]' : 'min-h-11 rounded-full border-2 border-[#2b062f] bg-white px-4 text-sm font-bold text-[#1a1020]'}
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
