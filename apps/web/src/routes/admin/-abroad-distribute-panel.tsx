import { useState } from 'react'
import { adminGhost } from '../../components/admin-ui'
import { adminAbroadDistributePreview, adminSaveAbroadDrafts } from '../../signup/abroad-distribute-admin'
import type { AbroadDistributePlan, AbroadSkipReason } from '../../signup/abroad-distribute'

const REASON_LABEL: Record<AbroadSkipReason, string> = {
  no_city: 'без град',
  city_not_found: 'градът не е в обхвата',
  no_capacity: 'няма свободно място',
  not_abroad: 'не е чужбина',
  mobile: 'мобилен',
  video: 'видеонаблюдение',
}

export function AbroadDistributePanel(props: {
  canEdit: boolean
  active: boolean
  setMessage: (message: string) => void
  onSaved: (notice?: string) => void
}) {
  const { canEdit, active, setMessage, onSaved } = props
  const [plan, setPlan] = useState<AbroadDistributePlan | null>(null)
  const [busy, setBusy] = useState<'preview' | 'save' | null>(null)
  const [armedSave, setArmedSave] = useState(false)

  if (!active || !canEdit) return null

  return (
    <section className="grid gap-3 border-t-2 border-[#2b062f] pt-6">
      <h2 className="text-xl font-black text-[#1a1020]">Разпределение чужбина</h2>
      <p className="text-sm text-[#333]">
        Първо преглед (без запис). После „Запиши като чернови“ — само draft_section, без публикуване, без имейл и без Brevo.
        Приоритет: tier C, D, B, A. Съвпадение по държава + град.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={adminGhost}
          disabled={busy !== null}
          onClick={() => {
            setArmedSave(false)
            setBusy('preview')
            void adminAbroadDistributePreview()
              .then((result) => {
                setBusy(null)
                if (!result.ok) {
                  setMessage(result.message)
                  setPlan(null)
                  return
                }
                setPlan(result.plan)
                setMessage(result.message)
              })
              .catch(() => {
                setBusy(null)
                setMessage('Прегледът за чужбина не тръгна.')
              })
          }}
        >
          {busy === 'preview' ? 'Смятаме…' : 'Преглед (без запис)'}
        </button>
        <button
          type="button"
          className={armedSave ? 'brand-button w-auto px-6' : adminGhost}
          disabled={busy !== null || !plan || plan.assignments.length === 0}
          onClick={() => {
            if (!armedSave) {
              setArmedSave(true)
              return
            }
            setArmedSave(false)
            setBusy('save')
            void adminSaveAbroadDrafts()
              .then((result) => {
                setBusy(null)
                setMessage(result.message)
                if (result.ok) {
                  setPlan(result.plan)
                  onSaved(result.message)
                }
              })
              .catch(() => {
                setBusy(null)
                setMessage('Черновите за чужбина не се записаха.')
              })
          }}
        >
          {busy === 'save'
            ? 'Записваме чернови…'
            : armedSave
              ? 'Да, запиши черновите (без публикуване)'
              : 'Запиши като чернови'}
        </button>
      </div>
      {plan ? (
        <div className="grid gap-3 text-sm text-[#1a1020]">
          <p className="font-bold">
            Чернови {plan.counts.assigned}
            {(['C', 'D', 'B', 'A'] as const).map((letter) => {
              const n = plan.counts.byTier[letter] ?? 0
              return n ? ` · ${letter} ${n}` : ''
            }).join('')}
          </p>
          {plan.counts.byCountry.length > 0 ? (
            <p>
              По държави:{' '}
              {plan.counts.byCountry
                .slice(0, 12)
                .map((row) => `${row.country} ${row.count}`)
                .join(' · ')}
            </p>
          ) : null}
          {plan.unmatched.length > 0 ? (
            <>
              <p className="font-bold">
                Без място {plan.unmatched.length}:{' '}
                {Object.entries(plan.counts.unmatchedByReason)
                  .filter(([, n]) => n)
                  .map(([reason, n]) => `${REASON_LABEL[reason as AbroadSkipReason] ?? reason} ${n}`)
                  .join(' · ')}
              </p>
              <ul className="grid max-h-64 gap-1 overflow-y-auto rounded-xl border border-[#d8c9dc] bg-white p-3">
                {plan.unmatched.map((row) => (
                  <li key={row.personId}>
                    {row.email} · {REASON_LABEL[row.reason] ?? row.reason}
                    {row.detail ? ` · ${row.detail}` : ''}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {plan.assignments.length > 0 ? (
            <ul className="grid max-h-48 gap-1 overflow-y-auto rounded-xl border border-[#d8c9dc] bg-[#f6f1f7] p-3">
              {plan.assignments.slice(0, 40).map((row) => (
                <li key={row.personId}>
                  {row.email} → {row.sectionId} · {row.city} · tier {row.tierLetter}
                </li>
              ))}
              {plan.assignments.length > 40 ? <li>… още {plan.assignments.length - 40}</li> : null}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
