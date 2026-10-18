import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { adminBrevoLists } from '../../signup/admin-brevo'
import {
  brevoListDisplayNames,
  brevoListLabel,
  filterBrevoListOptions,
  type BrevoListSummary,
} from '../../signup/brevo-lists'

const inputClass =
  'min-h-11 w-full rounded-xl border-2 border-[#4a314f] bg-white px-3 text-[#1a1020] placeholder:text-[#1a1020] focus:placeholder:text-[#666]'

type ListOption = { id: number; name: string; label: string }

/**
 * Searchable Brevo list picker (ARIA 1.2 combobox + listbox). Typing filters by name or id;
 * ArrowUp/ArrowDown move, Enter picks, Escape closes. Defaults to the configured list.
 */
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
      const options = buildOptions(result.lists, result.defaultListId, '')
      const next =
        value && options.some((option) => String(option.id) === value)
          ? value
          : result.defaultListId
            ? String(result.defaultListId)
            : options[0]
              ? String(options[0].id)
              : ''
      const picked = options.find((option) => String(option.id) === next)
      if (picked) onChange(next, picked.name)
    })
    return () => {
      cancelled = true
    }
    // Intentionally once on mount — parent owns later value changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const options = useMemo(() => buildOptions(lists, defaultListId, error), [lists, defaultListId, error])

  return (
    <div className="grid max-w-xl gap-1 text-sm font-semibold">
      {loading ? (
        <>
          <span>Списък в Brevo</span>
          <p className="text-sm font-normal text-[#333]">Зареждам списъците от Brevo…</p>
        </>
      ) : null}
      {error ? <p className="text-sm font-normal text-[#8f1d1d]">{error}</p> : null}
      {!loading && options.length > 0 ? (
        <ListCombobox
          options={options}
          value={value && options.some((option) => String(option.id) === value) ? value : String(options[0]!.id)}
          disabled={disabled}
          onPick={(option) => onChange(String(option.id), option.name)}
        />
      ) : null}
      {!loading && options.length === 0 && !error ? (
        <p className="text-sm font-normal text-[#333]">Няма налични списъци в Brevo.</p>
      ) : null}
    </div>
  )
}

function ListCombobox(props: {
  options: ListOption[]
  value: string
  disabled?: boolean
  onPick: (option: ListOption) => void
}) {
  const { options, value, disabled, onPick } = props
  const id = useId()
  const inputId = `${id}-input`
  const listboxId = `${id}-listbox`
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  const selected = options.find((option) => String(option.id) === value) ?? null
  const matches = useMemo(() => filterBrevoListOptions(options, query), [options, query])
  const activeOption = open ? matches[active] : undefined
  const optionId = (option: ListOption) => `${id}-option-${option.id}`

  useEffect(() => {
    if (!open || !activeOption) return
    const node = listRef.current?.querySelector<HTMLElement>(`[data-list-id="${activeOption.id}"]`)
    node?.scrollIntoView?.({ block: 'nearest' })
  }, [open, activeOption])

  function openList() {
    if (disabled) return
    setOpen(true)
    setQuery('')
    const index = options.findIndex((option) => String(option.id) === value)
    setActive(index >= 0 ? index : 0)
  }

  function close() {
    setOpen(false)
    setQuery('')
  }

  function pick(option: ListOption | undefined) {
    if (!option) return
    onPick(option)
    close()
  }

  return (
    <div className="relative grid gap-1">
      <label htmlFor={inputId}>Списък в Brevo</label>
      <input
        id={inputId}
        className={inputClass}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeOption ? optionId(activeOption) : undefined}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        placeholder={open ? (selected?.label ?? 'Търси списък') : ''}
        value={open ? query : (selected?.label ?? '')}
        onFocus={openList}
        onClick={() => {
          if (!open) openList()
        }}
        onBlur={close}
        onChange={(event) => {
          setQuery(event.target.value)
          setActive(0)
          setOpen(true)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            if (!open) {
              openList()
              return
            }
            if (matches.length === 0) return
            const step = event.key === 'ArrowDown' ? 1 : -1
            setActive((current) => (current + step + matches.length) % matches.length)
            return
          }
          if (event.key === 'Home' && open && matches.length > 0) {
            event.preventDefault()
            setActive(0)
            return
          }
          if (event.key === 'End' && open && matches.length > 0) {
            event.preventDefault()
            setActive(matches.length - 1)
            return
          }
          if (event.key === 'Enter') {
            if (!open) return
            event.preventDefault()
            pick(matches[active])
            return
          }
          if (event.key === 'Escape') {
            if (!open) return
            event.preventDefault()
            close()
          }
        }}
      />
      <ul
        ref={listRef}
        id={listboxId}
        role="listbox"
        aria-label="Списъци в Brevo"
        hidden={!open}
        className="absolute top-full right-0 left-0 z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border-2 border-[#4a314f] bg-white py-1 font-normal shadow-lg"
      >
        {matches.map((option, index) => {
          const isSelected = String(option.id) === value
          return (
            <li
              key={option.id}
              id={optionId(option)}
              data-list-id={option.id}
              role="option"
              aria-selected={isSelected}
              className={`cursor-pointer px-3 py-2 text-[#1a1020] ${index === active ? 'bg-[#e4f5f0]' : ''} ${isSelected ? 'font-bold' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => pick(option)}
            >
              {option.label}
            </li>
          )
        })}
        {matches.length === 0 ? <li className="px-3 py-2 text-[#333]">Няма такъв списък.</li> : null}
      </ul>
    </div>
  )
}

/** Shown when the default list is not in Brevo's listing (or listing failed). */
function fallbackListName(listId: number) {
  return `Основен списък #${listId}`
}

function buildOptions(lists: BrevoListSummary[], defaultListId: number | null, error: string): ListOption[] {
  if (error) {
    if (!defaultListId) return []
    const name = fallbackListName(defaultListId)
    return [{ id: defaultListId, name, label: name }]
  }
  const names = brevoListDisplayNames(lists)
  const options: ListOption[] = lists.map((list) => {
    const name = names.get(list.id) ?? list.name
    return { id: list.id, name, label: brevoListLabel(list, name) }
  })
  if (defaultListId && !lists.some((list) => list.id === defaultListId)) {
    const name = fallbackListName(defaultListId)
    options.unshift({ id: defaultListId, name, label: name })
  }
  return options
}
