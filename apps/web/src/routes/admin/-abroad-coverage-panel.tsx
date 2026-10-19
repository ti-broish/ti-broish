import { useEffect, useState } from 'react'
import { adminGhost, adminInput } from '../../components/admin-ui'
import { adminAbroadCoverage, adminImportAbroadCoverage } from '../../signup/abroad-coverage-admin'
import type { AbroadPriorityRow, AbroadTierLetter } from '../../signup/abroad-coverage'

export function AbroadCoveragePanel(props: {
  canEdit: boolean
  active: boolean
  setMessage: (message: string) => void
}) {
  const { canEdit, active, setMessage } = props
  const [rows, setRows] = useState<AbroadPriorityRow[]>([])
  const [countries, setCountries] = useState<string[]>([])
  const [cities, setCities] = useState<string[]>([])
  const [country, setCountry] = useState('')
  const [city, setCity] = useState('')
  const [tier, setTier] = useState('')
  const [summary, setSummary] = useState<{ total: number; byTier: Record<AbroadTierLetter, number> } | null>(null)
  const [loading, setLoading] = useState(false)

  function load(notice = '') {
    setLoading(true)
    void adminAbroadCoverage({ data: { country, city, tier } })
      .then((result) => {
        setLoading(false)
        if (!result.ok) {
          setMessage(result.message)
          setRows([])
          return
        }
        setRows(result.rows)
        setCountries(result.countries)
        setCities(result.cities)
        setSummary(result.summary)
        if (notice) setMessage(notice)
      })
      .catch(() => {
        setLoading(false)
        setMessage('Обхватът за чужбина не се зареди.')
      })
  }

  useEffect(() => {
    if (!active) return
    load()
  }, [active, country, city, tier])

  if (!active) return null

  return (
    <section className="grid gap-3 border-t-2 border-[#2b062f] pt-6">
      <h2 className="text-xl font-black text-[#1a1020]">Обхват чужбина (приоритетни секции)</h2>
      <p className="text-sm text-[#333]">
        CSV без лични данни: section_code, country, city, place_label, members, tier, ppdb_seats, da_seats,
        ppdb_seats_without_nominee, party_seats_allocated_in_file. Само кодове 32########. Повторното качване
        замества таблицата. Отделно от „Заети секции“.
      </p>
      {canEdit ? (
        <input
          className={`${adminInput} w-full`}
          type="file"
          accept=".csv,text/csv"
          aria-label="CSV с приоритетни секции в чужбина"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (!file) return
            void file.text().then((csv) =>
              adminImportAbroadCoverage({ data: { csv } }).then((result) => {
                if (!result.ok) setMessage(result.message)
                else load(result.message)
              }),
            )
          }}
        />
      ) : null}
      {summary ? (
        <p className="text-sm font-bold text-[#1a1020]">
          Общо {summary.total}: A {summary.byTier.A} · B {summary.byTier.B} · C {summary.byTier.C} · D {summary.byTier.D}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <label className="grid gap-1 text-sm font-bold text-[#1a1020]">
          Държава
          <select className={adminInput} value={country} onChange={(event) => { setCountry(event.target.value); setCity('') }}>
            <option value="">Всички</option>
            {countries.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-bold text-[#1a1020]">
          Град
          <select className={adminInput} value={city} onChange={(event) => setCity(event.target.value)}>
            <option value="">Всички</option>
            {cities.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-bold text-[#1a1020]">
          Tier
          <select className={adminInput} value={tier} onChange={(event) => setTier(event.target.value)}>
            <option value="">Всички</option>
            {(['C', 'D', 'B', 'A'] as const).map((letter) => (
              <option key={letter} value={letter}>{letter}</option>
            ))}
          </select>
        </label>
        <button type="button" className={adminGhost} onClick={() => load()}>
          {loading ? 'Зареждаме…' : 'Обнови'}
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-[#333]">{loading ? 'Зареждаме…' : 'Няма качени приоритетни секции.'}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-left text-sm text-[#1a1020]">
            <thead>
              <tr className="border-b-2 border-[#2b062f]">
                <th className="px-2 py-2">Секция</th>
                <th className="px-2 py-2">Държава</th>
                <th className="px-2 py-2">Град</th>
                <th className="px-2 py-2">Tier</th>
                <th className="px-2 py-2">ПП-ДБ</th>
                <th className="px-2 py-2">Да</th>
                <th className="px-2 py-2">ПП-ДБ без номинация</th>
                <th className="px-2 py-2">Място</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.sectionCode} className="border-b border-[#d8c9dc]">
                  <td className="px-2 py-2 font-mono text-xs">{row.sectionCode}</td>
                  <td className="px-2 py-2">{row.country}</td>
                  <td className="px-2 py-2">{row.city}</td>
                  <td className="px-2 py-2 font-bold">{row.tierLetter}</td>
                  <td className="px-2 py-2">{row.ppdbSeats}</td>
                  <td className="px-2 py-2">{row.daSeats}</td>
                  <td className="px-2 py-2">{row.ppdbSeatsWithoutNominee}</td>
                  <td className="px-2 py-2">{row.placeLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
