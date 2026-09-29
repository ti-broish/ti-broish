import { useMemo, useState } from 'react'
import { OBLASTS } from '../signup/oblasts'
import { highlightCodes, type Profile } from '../signup/model'
import { updateProfile } from '../signup/store'

function toggleCode(profile: Profile, code: string) {
  const home = profile.place?.regionCode
  if (code === home || (home === 'sofia-merged' && ['23', '24', '25'].includes(code))) return
  const exists = profile.distantRegionCodes.includes(code)
  updateProfile({
    distantRegionCodes: exists ? profile.distantRegionCodes.filter((item) => item !== code) : [...profile.distantRegionCodes, code],
  })
}

export function OblastPicker({ profile }: { profile: Profile }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const home = useMemo(() => new Set(highlightCodes(profile.place, 'region', [])), [profile.place])
  const homeOblast = OBLASTS.find((oblast) => oblast.regionCodes.some((code) => home.has(code)))
  const choices = OBLASTS.filter((oblast) => !oblast.regionCodes.some((code) => home.has(code)))
  const selected = choices.filter((oblast) => oblast.regionCodes.some((code) => profile.distantRegionCodes.includes(code)))
  const needle = query.trim().toLocaleLowerCase('bg')
  const matches = choices
    .filter((oblast) => !selected.some((item) => item.id === oblast.id))
    .filter((oblast) => !needle || oblast.name.toLocaleLowerCase('bg').includes(needle))
    .slice(0, 8)

  function add(code: string | undefined) {
    if (!code) return
    toggleCode(profile, code)
    setQuery('')
    setOpen(false)
  }

  return (
    <div className="grid gap-3">
      <label className="grid gap-1 text-sm font-semibold">
        Други области
        <input
          className="min-h-11 w-full rounded-xl border border-[#ddd] bg-white px-3"
          value={query}
          placeholder="Напиши област"
          role="combobox"
          aria-expanded={open}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              add(matches[0]?.regionCodes[0])
            }
            if (event.key === 'Escape') setOpen(false)
          }}
        />
      </label>
      {open && matches.length > 0 ? (
        <ul className="grid overflow-hidden rounded-xl border border-[#ddd] bg-white">
          {matches.map((oblast) => (
            <li key={oblast.id}>
              <button type="button" className="min-h-12 w-full px-3 text-left font-bold" onClick={() => add(oblast.regionCodes[0])}>
                {oblast.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {open && needle && matches.length === 0 ? <p className="text-sm">Няма такава област.</p> : null}
      <ul className="flex flex-wrap gap-2">
        {homeOblast ? (
          <li>
            <span className="inline-flex min-h-11 items-center rounded-full bg-[#e4f5f0] px-4 font-bold text-[#2b062f]">{homeOblast.name}</span>
          </li>
        ) : null}
        {selected.map((oblast) => (
          <li key={oblast.id}>
            <button
              type="button"
              className="min-h-11 rounded-full bg-[#53c0a4] px-4 font-bold text-[#2b062f]"
              onClick={() => toggleCode(profile, oblast.regionCodes[0] ?? '')}
            >
              {oblast.name} ×
            </button>
          </li>
        ))}
      </ul>
      {selected.length === 0 ? <p className="text-sm leading-6">Избери от списъка. Може и от картата, ако е отворена.</p> : null}
    </div>
  )
}
