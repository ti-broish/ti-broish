import { useEffect, useRef, useState } from 'react'
import {
  apiRegionCodes,
  displayRegions,
  fetchCountries,
  fetchRegions,
  fetchSections,
  fetchTowns,
  type CityRegion,
  type Country,
  type ElectionRegion,
  type PollingSection,
  type Town,
} from '../signup/geo'
import type { HomePlace } from '../signup/model'
import { sofiaMir } from '../signup/rules'
import { placeSummaries } from '../signup/sections'

const inputClass =
  'min-h-11 w-full rounded-xl border border-[var(--line)] bg-white px-3 text-base text-[var(--ink)]'

export function PlacesPicker({
  value,
  onChange,
  sectionLabel = 'Адрес, ако имаш предпочитание',
  footnote,
  onGeography,
  lockedMir = null,
}: {
  value: HomePlace | null
  onChange: (place: HomePlace | null) => void
  sectionLabel?: string
  footnote?: string
  onGeography?: (info: { districts: CityRegion[]; sections: PollingSection[] }) => void
  lockedMir?: string | null
}) {
  const [regions, setRegions] = useState<ElectionRegion[]>([])
  const [countries, setCountries] = useState<Country[]>([])
  const [towns, setTowns] = useState<Town[]>([])
  const [sections, setSections] = useState<PollingSection[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const onChangeRef = useRef(onChange)
  const autoTownFor = useRef<string | null>(null)
  const autoSectionFor = useRef<string | null>(null)
  onChangeRef.current = onChange

  useEffect(() => {
    void fetchRegions()
      .then((data) => setRegions(displayRegions(data)))
      .catch(() => setError('Не успяхме да заредим областите. Опитай пак.'))
      .finally(() => setLoading(false))
  }, [])

  const region = regions.find((item) => item.code === value?.regionCode)
  const abroad = value?.regionCode === '32'

  useEffect(() => {
    if (!abroad) return
    void fetchCountries()
      .then((data) => setCountries([...data].sort((a, b) => a.name.localeCompare(b.name, 'bg'))))
      .catch(() => setError('Не успяхме да заредим държавите.'))
  }, [abroad])

  useEffect(() => {
    if (!value?.municipalityCode || !region || abroad) {
      setTowns([])
      return
    }
    let cancelled = false
    setTowns([])
    void fetchTowns({ data: { regionCodes: apiRegionCodes(region), municipalityCode: value.municipalityCode } })
      .then((data) => {
        if (!cancelled) setTowns(data)
      })
      .catch(() => {
        if (!cancelled) setError('Не успяхме да заредим населените места.')
      })
    return () => {
      cancelled = true
    }
  }, [value?.municipalityCode, value?.regionCode, abroad, region])

  useEffect(() => {
    if (!value?.townId || abroad) {
      setSections([])
      return
    }
    void fetchSections({ data: { townId: value.townId, cityRegionCode: value.cityRegionCode } })
      .then((data) => setSections(data))
      .catch(() => setSections([]))
  }, [value?.townId, value?.cityRegionCode, abroad])

  useEffect(() => {
    if (!region || abroad || value?.municipalityCode) return
    const list = region.municipalities ?? []
    if (list.length !== 1) return
    const municipality = list[0]
    if (!municipality) return
    onChangeRef.current({
      regionCode: region.code,
      regionName: region.name,
      municipalityCode: municipality.code,
      municipalityName: municipality.name,
    })
  }, [abroad, region, value?.municipalityCode])

  useEffect(() => {
    if (abroad || !value?.municipalityCode || value.townId || towns.length === 0) return
    if (autoTownFor.current === value.municipalityCode) return
    autoTownFor.current = value.municipalityCode
    const pick = pickTown(towns)
    if (!pick) return
    const district = pick.cityRegions.length === 1 ? pick.cityRegions[0] : undefined
    onChangeRef.current({
      regionCode: value.regionCode,
      regionName: value.regionName,
      municipalityCode: value.municipalityCode,
      municipalityName: value.municipalityName,
      townId: pick.id,
      townName: pick.name,
      cityRegionCode: district?.code,
      cityRegionName: district?.name,
    })
  }, [abroad, towns, value?.municipalityCode, value?.municipalityName, value?.regionCode, value?.regionName, value?.townId])

  useEffect(() => {
    if (!value?.townId || value.sectionPlace) return
    const sectionKey = `${value.townId}:${value.cityRegionCode ?? ''}`
    if (autoSectionFor.current === sectionKey) return
    const groups = placeSummaries(sections)
    if (groups.length !== 1) return
    autoSectionFor.current = sectionKey
    const group = groups[0]
    if (!group) return
    onChangeRef.current({
      ...value,
      sectionId: undefined,
      sectionPlace: group.place,
      paperCount: group.paper,
      machineCount: group.machine,
    })
  }, [sections, value])

  function setRegion(code: string) {
    const next = regions.find((item) => item.code === code)
    if (!next) {
      onChange(null)
      return
    }
    onChange({ regionCode: next.code, regionName: next.name })
  }

  const municipalities = [...(region?.municipalities ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'bg'))
  const sortedTowns = [...towns].sort((a, b) => {
    const aCity = a.name.startsWith('гр.')
    const bCity = b.name.startsWith('гр.')
    if (aCity !== bCity) return aCity ? -1 : 1
    return a.name.localeCompare(b.name, 'bg')
  })
  const town = towns.find((item) => item.id === value?.townId)
  const districts = [...(town?.cityRegions ?? [])]
    .filter((item) => !lockedMir || value?.regionCode !== 'sofia-merged' || sofiaMir(item.name) === lockedMir)
    .sort((a, b) => a.name.localeCompare(b.name, 'bg'))
  const addresses = placeSummaries(sections)
  const districtKey = districts.map((item) => item.code).join(',')
  const sectionKey = sections.map((item) => item.id).join(',')
  const onGeographyRef = useRef(onGeography)
  const districtsRef = useRef(districts)
  const sectionsRef = useRef(sections)
  onGeographyRef.current = onGeography
  districtsRef.current = districts
  sectionsRef.current = sections
  useEffect(() => {
    onGeographyRef.current?.({ districts: districtsRef.current, sections: sectionsRef.current })
  }, [districtKey, sectionKey])

  if (loading) return <p className="text-[var(--ink-soft)]">Зареждаме областите…</p>
  if (error) return <p className="text-red-700">{error}</p>

  return (
    <div className="grid gap-4">
      <label className="grid gap-1.5 text-sm font-semibold">
        Област
        <select className={inputClass} value={value?.regionCode ?? ''} disabled={Boolean(lockedMir)} onChange={(event) => setRegion(event.target.value)}>
          <option value="">Избери</option>
          {regions.map((item) => (
            <option key={item.code} value={item.code}>
              {item.name}
            </option>
          ))}
        </select>
      </label>

      {!abroad && value?.regionCode ? (
        <label className="grid gap-1.5 text-sm font-semibold">
          Община
          <select
            className={inputClass}
            value={value.municipalityCode ?? ''}
            onChange={(event) => {
              const municipality = municipalities.find((item) => item.code === event.target.value)
              onChange({
                regionCode: value.regionCode,
                regionName: value.regionName,
                municipalityCode: municipality?.code,
                municipalityName: municipality?.name,
              })
            }}
          >
            <option value="">Избери</option>
            {municipalities.map((item) => (
              <option key={item.code} value={item.code}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {abroad ? (
        <>
          <label className="grid gap-1.5 text-sm font-semibold">
            Държава
            <select
              className={inputClass}
              value={value?.countryCode ?? ''}
              onChange={(event) => {
                const country = countries.find((item) => item.code === event.target.value)
                onChange({
                  regionCode: '32',
                  regionName: 'Извън страната',
                  countryCode: country?.code,
                  countryName: country?.name,
                })
              }}
            >
              <option value="">Избери</option>
              {countries.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-semibold">
            Град
            <input
              className={inputClass}
              value={value?.townName ?? ''}
              onChange={(event) => onChange({ ...(value as HomePlace), townName: event.target.value })}
            />
          </label>
        </>
      ) : null}

      {!abroad && value?.municipalityCode ? (
        <label className="grid gap-1.5 text-sm font-semibold">
          Населено място
          <select
            className={inputClass}
            value={value.townId ?? ''}
            onChange={(event) => {
              const nextTown = towns.find((item) => String(item.id) === event.target.value)
              onChange({
                regionCode: value.regionCode,
                regionName: value.regionName,
                municipalityCode: value.municipalityCode,
                municipalityName: value.municipalityName,
                townId: nextTown?.id,
                townName: nextTown?.name,
              })
            }}
          >
            <option value="">Избери</option>
            {sortedTowns.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {districts.length > 0 ? (
        <label className="grid gap-1.5 text-sm font-semibold">
          Район
          <select
            className={inputClass}
            value={value?.cityRegionCode ?? ''}
            onChange={(event) => {
              const district = districts.find((item) => item.code === event.target.value)
              onChange({
                ...(value as HomePlace),
                cityRegionCode: district?.code,
                cityRegionName: district?.name,
                sectionId: undefined,
                sectionPlace: undefined,
              })
            }}
          >
            <option value="">Избери</option>
            {districts.map((item) => (
              <option key={item.code} value={item.code}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {!abroad && value?.townId ? (
        <label className="grid gap-1.5 text-sm font-semibold">
          {sectionLabel}
          <select
            className={inputClass}
            value={value.sectionPlace ?? ''}
            onChange={(event) => {
              const group = addresses.find((item) => item.place === event.target.value)
              onChange({
                ...(value as HomePlace),
                sectionId: undefined,
                sectionPlace: group?.place,
                paperCount: group ? group.paper : null,
                machineCount: group ? group.machine : null,
              })
            }}
          >
            <option value="">Без конкретен адрес</option>
            {addresses.map((group) => (
              <option key={group.place} value={group.place}>
                {group.place} · {group.sections.length} секции, {group.paper} хартиени, {group.machine} машинни
                {group.unknown > 0 ? `, ${group.unknown} без брой` : ''}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {footnote === '' ? null : (
        <p className="rounded-xl bg-[var(--sand)] px-3 py-2 text-sm leading-6 text-[var(--ink-soft)]">
          {footnote ??
            'Можеш да гласуваш само там, където обичайно гласуваш. Разпределението не ти дава право да гласуваш в секцията, в която те изпратим.'}
        </p>
      )}
    </div>
  )
}

function pickTown(towns: Town[]) {
  if (towns.length === 1) return towns[0] ?? null
  const withDistricts = towns.filter((town) => town.cityRegions.length > 1)
  if (withDistricts.length === 1) return withDistricts[0] ?? null
  if (withDistricts.length > 1) {
    return withDistricts.reduce((best, town) => (town.cityRegions.length >= best.cityRegions.length ? town : best))
  }
  const cities = towns.filter((town) => town.name.startsWith('гр.'))
  if (cities.length === 1) return cities[0] ?? null
  return null
}


