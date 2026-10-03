import { useState } from 'react'
import { adminGhost, adminChipOn } from '../../components/admin-ui'
import { adminBulkCallback } from '../../signup/admin'

export function SelectPerson({ name, checked, onChange }: { name: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <input
      type="checkbox"
      className="h-5 w-5"
      checked={checked}
      aria-label={`Избери ${name || 'човека'}`}
      onChange={(event) => onChange(event.target.checked)}
    />
  )
}

export function BulkCallbackBar({
  total,
  visibleCount,
  selectedCount,
  wholeView,
  onWholeView,
  view,
  mir,
  q,
  ids,
  onApplied,
}: {
  total: number
  visibleCount: number
  selectedCount: number
  wholeView: boolean
  onWholeView: () => void
  view: string
  mir: string
  q: string
  ids: string[]
  onApplied: (message: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const ready = wholeView || ids.length > 0
  const showWhole = total > visibleCount
  async function run(called: boolean) {
    setBusy(true)
    try {
      const result = await adminBulkCallback({
        data: wholeView
          ? { called, scope: 'filter', view, mir, q }
          : { called, scope: 'ids', ids, view, mir, q },
      })
      onApplied(result.ok ? result.message : result.message)
    } catch {
      onApplied('Обажданията не се отбелязаха.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Групови обаждания">
      <p className="text-sm font-bold text-[#1a1020]">{wholeView ? `Целият изглед: ${total}` : `Избрани: ${selectedCount}`}</p>
      {showWhole ? (
        <button type="button" className={wholeView ? adminChipOn : adminGhost} aria-pressed={wholeView} onClick={onWholeView}>
          {wholeView ? 'Само избраните редове' : `Целият изглед (${total})`}
        </button>
      ) : null}
      <button type="button" className={adminGhost} disabled={!ready || busy} onClick={() => void run(true)}>
        Отбележи обаждане
      </button>
      <button type="button" className={adminGhost} disabled={!ready || busy} onClick={() => void run(false)}>
        Махни обаждането
      </button>
    </div>
  )
}
