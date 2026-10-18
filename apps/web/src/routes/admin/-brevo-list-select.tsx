import { useEffect, useState } from 'react'
import { adminBrevoLists } from '../../signup/admin-brevo'
import { brevoListDisplayNames, brevoListLabel, type BrevoListSummary } from '../../signup/brevo-lists'

const selectClass =
  'min-h-11 w-full max-w-xl rounded-xl border-2 border-[#4a314f] bg-white px-3 text-[#1a1020]'

export function BrevoListSelect(props: {
  value: string
  /** Called with the list id and its display name (with „ · #id“ only for duplicate names). */
  onChange: (listId: string, listName: string) => void
  disabled?: boolean
}) {
  const { value, onChange, disabled } = props
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lists, setLists] = useState<BrevoListSummary[]>([])
  const [defaultListId, setDefaultListId] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    void adminBrevoLists().then((result) => {
      if (cancelled) return
      setLoading(false)
      if (!result.ok) {
        const fallback = 'defaultListId' in result ? result.defaultListId : null
        setError(
          fallback
            ? `Не успях да заредя списъците от Brevo: ${result.message} Използва се основният списък (#${fallback}).`
            : `Не успях да заредя списъците от Brevo: ${result.message}`,
        )
        setLists([])
        setDefaultListId(fallback)
        if (fallback && !value) onChange(String(fallback), fallbackListName(fallback))
        return
      }
      if (!result.configured) {
        setError(result.message)
        setLists([])
        setDefaultListId(null)
        return
      }
      setLists(result.lists)
      setDefaultListId(result.defaultListId)
      const next =
        value && result.lists.some((list) => String(list.id) === value)
          ? value
          : result.defaultListId
            ? String(result.defaultListId)
            : result.lists[0]
              ? String(result.lists[0].id)
              : ''
      if (next) onChange(next, listNameFor(result.lists, result.defaultListId, next))
    })
    return () => {
      cancelled = true
    }
    // Intentionally once on mount — parent owns later value changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const options = buildOptions(lists, defaultListId, error)

  return (
    <label className="grid gap-1 text-sm font-semibold">
      Списък в Brevo
      {loading ? <p className="text-sm font-normal text-[#333]">Зареждам списъците от Brevo…</p> : null}
      {error ? <p className="text-sm font-normal text-[#8f1d1d]">{error}</p> : null}
      {!loading && options.length > 0 ? (
        <select
          className={selectClass}
          value={value && options.some((option) => option.value === value) ? value : options[0]!.value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value, listNameFor(lists, defaultListId, event.target.value))}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : null}
      {!loading && options.length === 0 && !error ? (
        <p className="text-sm font-normal text-[#333]">Няма налични списъци в Brevo.</p>
      ) : null}
    </label>
  )
}

function buildOptions(
  lists: BrevoListSummary[],
  defaultListId: number | null,
  error: string,
): Array<{ value: string; label: string }> {
  if (error) {
    if (!defaultListId) return []
    return [{ value: String(defaultListId), label: fallbackListName(defaultListId) }]
  }
  const names = brevoListDisplayNames(lists)
  const options = lists.map((list) => ({
    value: String(list.id),
    label: brevoListLabel(list, names.get(list.id)),
  }))
  if (defaultListId && !lists.some((list) => list.id === defaultListId)) {
    options.unshift({
      value: String(defaultListId),
      label: fallbackListName(defaultListId),
    })
  }
  return options
}

/** Shown when the default list is not in Brevo's listing (or listing failed). */
function fallbackListName(listId: number) {
  return `Основен списък #${listId}`
}

function listNameFor(lists: BrevoListSummary[], defaultListId: number | null, value: string) {
  const id = Number(value)
  const name = brevoListDisplayNames(lists).get(id)
  if (name) return name
  if (defaultListId === id) return fallbackListName(id)
  return `Списък #${value}`
}
