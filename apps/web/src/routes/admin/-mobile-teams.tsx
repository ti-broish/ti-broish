import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { adminGhost } from '../../components/admin-ui'
import { priorityLevelLabel, formatR } from '../../signup/priority-sections'
import type { MobileArea, MobileTarget } from '../../signup/mobile-teams'
import {
  adminMobileDistribute,
  adminMobileDrafts,
  adminMobileRemove,
  adminMobileSave,
  adminMobileSuggest,
} from '../../signup/mobile-teams-admin'

export type MobileDraftView = {
  signupId: string
  teamKey: string
  mir: string
  areaLabel: string
  targets: MobileTarget[]
  source: string
  name: string
  rounds: string
  car: boolean
  drone: boolean
}

let cache: { at: number; value: Promise<{ drafts: MobileDraftView[]; waiting: number }> } | null = null

export function loadMobileIndex(force = false) {
  if (!cache || force || Date.now() - cache.at > 30_000) {
    cache = {
      at: Date.now(),
      value: adminMobileDrafts()
        .then((result) => (result.ok ? { drafts: result.drafts as MobileDraftView[], waiting: result.waiting } : { drafts: [], waiting: 0 }))
        .catch(() => ({ drafts: [], waiting: 0 })),
    }
  }
  return cache.value
}

/** signupId → mobile draft, shared by every row on the page. */
export function useMobileIndex(version = 0) {
  const [index, setIndex] = useState<Record<string, MobileDraftView>>({})
  useEffect(() => {
    let live = true
    void loadMobileIndex(version > 0).then((value) => {
      if (live) setIndex(Object.fromEntries(value.drafts.map((draft) => [draft.signupId, draft])))
    })
    return () => {
      live = false
    }
  }, [version])
  return index
}

export function MobileBadge({ draft }: { draft: Pick<MobileDraftView, 'areaLabel' | 'targets'> | null | undefined }) {
  if (!draft) return null
  return (
    <span
      className="inline-flex min-h-6 items-center whitespace-nowrap rounded-full bg-[#1f4d7a] px-2 text-xs font-black text-white"
      title={`Чернова за мобилен екип: ${draft.areaLabel}. Секции: ${draft.targets.map((target) => target.code).join(', ')}`}
      data-testid="mobile-badge"
    >
      🚐 Мобилен · {draft.areaLabel} · {draft.targets.length} секц.
    </span>
  )
}

function Targets({ targets }: { targets: MobileTarget[] }) {
  return (
    <ul className="grid gap-0.5 text-xs">
      {targets.map((target) => (
        <li key={target.code}>
          <span className="font-mono font-bold">{target.code}</span> · {priorityLevelLabel(target.level)} R {formatR(target.r)}
          {target.town ? ` · ${target.town}` : ''}
        </li>
      ))}
    </ul>
  )
}

/** Секции: the mobile-team drafts and the „Чернови за мобилни екипи“ button. */
export function MobileTeamsPanel({ canEdit, setMessage }: { canEdit: boolean; setMessage: (message: string) => void }) {
  const [version, setVersion] = useState(0)
  const [data, setData] = useState<{ drafts: MobileDraftView[]; waiting: number }>({ drafts: [], waiting: 0 })
  const [busy, setBusy] = useState(false)
  const [armed, setArmed] = useState(false)
  const [preview, setPreview] = useState('')
  useEffect(() => {
    void loadMobileIndex(version > 0).then(setData)
  }, [version])

  function run(dryRun: boolean) {
    setBusy(true)
    void adminMobileDistribute({ data: { dryRun } })
      .then((result) => {
        setBusy(false)
        setMessage(result.message)
        if (dryRun) setPreview(result.message)
        else {
          setPreview('')
          setVersion((value) => value + 1)
        }
      })
      .catch(() => {
        setBusy(false)
        setMessage('Мобилните чернови не се записаха. Опитай пак.')
      })
  }

  const teams = new Set(data.drafts.map((draft) => draft.teamKey)).size
  const covered = new Set(data.drafts.flatMap((draft) => draft.targets.map((target) => target.code))).size
  return (
    <details className="rounded-2xl border-2 border-[#1f4d7a] bg-white p-3" data-testid="mobile-panel">
      <summary className="cursor-pointer text-sm font-bold text-[#1a1020]">
        Мобилни екипи — чернови {data.drafts.length} души в {teams} екипа · приоритетни секции с мобилен екип {covered} · без чернова {data.waiting}
      </summary>
      <div className="mt-3 grid gap-3 text-sm text-[#1a1020]">
        <p>
          Мобилен екип получава район (МИР и община, или град/район, ако човекът стига само дотам) и до 5 приоритетни секции без наш човек, по R (до 3 без кола). Обхватът е
          според записването: радиус, избрани общини и области, кола. Екип с общ адрес остава заедно. Резервираните секции и вече покритите не влизат. Само чернова: не
          публикуваме, не номерираме и не пращаме писма.
        </p>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={adminGhost} disabled={busy} onClick={() => run(true)}>
              Преглед за мобилни екипи
            </button>
            <button
              type="button"
              className={armed ? 'brand-button w-auto px-6' : adminGhost}
              disabled={busy}
              onClick={() => {
                if (!armed) {
                  setArmed(true)
                  return
                }
                setArmed(false)
                run(false)
              }}
            >
              {busy ? 'Смятаме…' : armed ? 'Да, чернови за мобилните екипи без чернова (без публикуване)' : 'Чернови за мобилни екипи'}
            </button>
          </div>
        ) : null}
        {preview ? <p className="rounded-xl bg-[#eef4fa] p-2 font-bold" data-testid="mobile-preview">{preview}</p> : null}
        {data.drafts.length ? (
          <table className="w-full text-left text-sm" data-testid="mobile-drafts">
            <thead>
              <tr>
                <th>Човек</th>
                <th>Район</th>
                <th>Секции</th>
                <th>Дни · транспорт</th>
                {canEdit ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {data.drafts.map((draft) => (
                <tr key={draft.signupId} className="border-t align-top">
                  <td className="py-1">
                    <Link to="/admin/signups/$personId" params={{ personId: draft.signupId }} className="font-bold underline">
                      {draft.name || draft.signupId.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="py-1">{draft.areaLabel}</td>
                  <td className="py-1">
                    <Targets targets={draft.targets} />
                  </td>
                  <td className="py-1">
                    {draft.rounds} · {draft.car ? 'кола' : 'без кола'}
                    {draft.drone ? ' · дрон' : ''}
                  </td>
                  {canEdit ? (
                    <td className="py-1">
                      <button
                        type="button"
                        className={adminGhost}
                        onClick={() =>
                          void adminMobileRemove({ data: { id: draft.signupId } }).then((result) => {
                            setMessage(result.message)
                            setVersion((value) => value + 1)
                          })
                        }
                      >
                        Махни
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </details>
  )
}

/** Person page: the mobile draft, „Предложи“ and saving one area. */
export function MobileDraftCard({ personId, canEdit, mobile }: { personId: string; canEdit: boolean; mobile: boolean }) {
  const [version, setVersion] = useState(0)
  const index = useMobileIndex(version)
  const draft = index[personId]
  const [areas, setAreas] = useState<MobileArea[] | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  if (!mobile && !draft) return null
  return (
    <section className="grid gap-2 rounded-2xl border-2 border-[#1f4d7a] bg-white p-4 text-sm text-[#1a1020]" data-testid="mobile-card">
      <h2 className="text-base font-black">Мобилен екип</h2>
      {draft ? (
        <div className="grid gap-1">
          <p>
            <MobileBadge draft={draft} /> Чернова ({draft.source === 'manual' ? 'ръчна' : 'от разпределението'}), не е публикувана. {draft.rounds}.
          </p>
          <Targets targets={draft.targets} />
        </div>
      ) : (
        <p>Няма чернова за мобилен екип.</p>
      )}
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={adminGhost}
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void adminMobileSuggest({ data: { id: personId } }).then((result) => {
                setBusy(false)
                setAreas(result.ok ? result.areas : [])
                setMessage(result.message)
              })
            }}
          >
            Предложи
          </button>
          {draft ? (
            <button
              type="button"
              className={adminGhost}
              disabled={busy}
              onClick={() =>
                void adminMobileRemove({ data: { id: personId } }).then((result) => {
                  setMessage(result.message)
                  setVersion((value) => value + 1)
                })
              }
            >
              Махни черновата
            </button>
          ) : null}
        </div>
      ) : null}
      {message ? <p className="font-bold">{message}</p> : null}
      {areas && areas.length ? (
        <ul className="grid gap-2" data-testid="mobile-suggestions">
          {areas.map((area) => (
            <li key={area.key} className="rounded-xl border p-2">
              <p className="font-bold">
                {area.label} · сбор R {formatR(area.score)}
              </p>
              <Targets targets={area.targets} />
              <button
                type="button"
                className={adminGhost}
                disabled={busy}
                onClick={() => {
                  setBusy(true)
                  void adminMobileSave({ data: { id: personId, areaKey: area.key } }).then((result) => {
                    setBusy(false)
                    setMessage(result.message)
                    if (result.ok) {
                      setAreas(null)
                      setVersion((value) => value + 1)
                    }
                  })
                }}
              >
                Запиши като чернова
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
