import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import type { AssignWarning } from '../../signup/admin-assign'
import type { RosterFields } from '../../signup/admin-csv'
import { adminDraft } from '../../signup/admin-assign-actions'
import { adminGhost } from '../../components/admin-ui'
import { addressDeskLine, deskLabel } from '../../signup/sections'
import { EMPTY_SECTION_DIRECTORY, sectionSpot, signupSpot, type SectionSpot } from '../../signup/section-where'
import type { PriorityInfo } from '../../signup/priority-sections'
import { PriorityBadge } from './-priority-badge'
import { ReservedBadge, reservedOrgFor } from './-reserved-badge'
import { MobileBadge, type MobileDraftView } from './-mobile-teams'

export function DeskBadge({ desk }: { desk: 'paper' | 'machine' | 'unknown' }) {
  const tone =
    desk === 'paper'
      ? 'bg-[#53c0a4] text-[#2b062f]'
      : desk === 'machine'
        ? 'bg-[#3a3140] text-white'
        : 'border border-[#2b062f] bg-[#f4e4b3] text-[#1a1020]'
  return <span className={`inline-flex min-h-6 items-center rounded-full px-2 text-xs font-black ${tone}`}>{deskLabel(desk)}</span>
}

export function SectionPersonRow(props: {
  person: RosterFields
  canEdit: boolean
  draftValues: Record<string, string>
  setDraftValues: (updater: (current: Record<string, string>) => Record<string, string>) => void
  warnings: AssignWarning[]
  setRowWarnings: (updater: (current: Record<string, AssignWarning[]>) => Record<string, AssignWarning[]>) => void
  setMessage: (message: string) => void
  /** Reloads the list; the notice stays visible after the reload. */
  load: (notice?: string) => void
  canPublish: boolean
  /** No-email publish of this row's draft. */
  publish: (id: string) => Promise<unknown>
  unpublish: (id: string) => Promise<{ ok: boolean; message: string }>
  picked: boolean
  onPick: (on: boolean) => void
  notifyAgain: (id: string) => Promise<{ ok: boolean; message: string }>
  spots: Record<string, SectionSpot>
  /** Priority section code → R and level. */
  priority?: Record<string, PriorityInfo>
  /** Best priority section reachable from where the person signed up. */
  reach?: (PriorityInfo & { scope: 'town' | 'municipality' }) | null
  /** Reserved section code → organisation. */
  reserved?: Record<string, string>
  /** This person's mobile-team area draft, if any. */
  mobile?: MobileDraftView | null
}) {
  const {
    person, canEdit, draftValues, setDraftValues, warnings, setRowWarnings,
    setMessage, load,
    canPublish, publish, unpublish, picked, onPick, notifyAgain, spots, priority = {}, reach = null, reserved = {}, mobile = null,
  } = props
  const pendingDraft = Boolean(person.draftSection && person.draftSection !== person.publishedSection)
  const signed = signupSpot(person)
  const draftCode = draftValues[person.id] ?? person.draftSection
  const [armedUnpublish, setArmedUnpublish] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const name = [person.firstName, person.lastName].filter(Boolean).join(' ') || person.email
  return (
                <tr className="border-b border-[#eee] align-top" data-testid="section-person-row">
                  <td className="py-3 pr-2">
                    {canPublish && pendingDraft ? (
                      <input type="checkbox" aria-label={`Избери ${name}`} checked={picked} onChange={(event) => onPick(event.target.checked)} />
                    ) : null}
                  </td>
                  <td className="py-3 pr-3">
                    <p>
                      <Link to="/admin/signups/$personId" params={{ personId: person.id }} className="font-bold text-[#2b062f] underline">
                        {[person.firstName, person.lastName].filter(Boolean).join(' ') || '—'}
                      </Link>
                    </p>
                    <p>{person.email}</p>
                    {person.role === 'mobile' ? (
                      <p className="mt-1" data-testid="mobile-row">
                        {mobile ? (
                          <MobileBadge draft={mobile} />
                        ) : (
                          <span className="inline-flex min-h-6 items-center rounded-full border border-[#1f4d7a] px-2 text-xs font-black text-[#1f4d7a]">🚐 Мобилен екип · без район</span>
                        )}{' '}
                        <Link to="/admin/signups/$personId" params={{ personId: person.id }} className="text-xs font-bold underline">
                          Район
                        </Link>
                      </p>
                    ) : null}
                    {addressDeskLine(person.paperCount, person.machineCount) ? (
                      <p className="text-xs font-bold text-[#1a1020]">{addressDeskLine(person.paperCount, person.machineCount)}</p>
                    ) : null}
                  </td>
                  <td className="py-3 pr-3">
                    <p>{signed.oblast || '—'}</p>
                    {person.region === '32' ? <p className="text-xs text-[#333]">чужбина</p> : person.mir ? <p className="text-xs text-[#333]">МИР {person.mir}</p> : null}
                  </td>
                  <td className="py-3 pr-3">{signed.municipality || '—'}</td>
                  <td className="py-3 pr-3">
                    <p>{signed.town || '—'}</p>
                    {reach ? (
                      <p className="mt-1 text-xs text-[#333]">
                        <PriorityBadge info={reach} /> {reach.scope === 'town' ? 'в града' : 'в общината'}
                      </p>
                    ) : null}
                  </td>
                  <td className="py-3 pr-3">{signed.district || '—'}</td>
                  <td className="max-w-xs py-3 pr-3">{signed.address || '—'}</td>
                  <td className="max-w-xs py-3 pr-3">{signed.reach || '—'}</td>
                  <td className="whitespace-nowrap py-3 pr-3">
                    {person.draftSection && person.draftLocked ? (
                      <p className="mb-1 text-xs font-bold text-[#1a1020]">Ръчна чернова: разпределението не я сменя.</p>
                    ) : null}
                    {priorityOf(draftCode, priority) ? (
                      <p className="mb-1"><PriorityBadge info={priorityOf(draftCode, priority)} /></p>
                    ) : null}
                    {reservedOrgFor(draftCode, reserved) ? (
                      <p className="mb-1"><ReservedBadge org={reservedOrgFor(draftCode, reserved)} conflict={draftCode === person.draftSection} /></p>
                    ) : null}
                    {canEdit ? (
                      <div className="grid gap-2">
                        <form
                          className="flex flex-wrap gap-2"
                          onSubmit={(event) => {
                            event.preventDefault()
                            // „Запази“ only saves a manual draft: never publishes, never sends email.
                            const section = draftValues[person.id] ?? person.draftSection
                            setSaving(true)
                            void adminDraft({ data: { id: person.id, section } }).then((result) => {
                              setSaving(false)
                              if (!result.ok) {
                                setMessage(result.message)
                                if ('reserved' in result) setRowWarnings((current) => ({ ...current, [person.id]: [{ code: 'taken', level: 'block', message: result.message }] }))
                              }
                              else {
                                setRowWarnings((current) => ({ ...current, [person.id]: result.warnings ?? [] }))
                                const text = (
                                  result.warning
                                    ? result.blockedOnPublish
                                      ? `Черновата е запазена, но няма да се публикува: ${result.warning}`
                                      : result.warning
                                    : section.trim()
                                      ? 'Черновата е сложена (ръчна) и не се вижда от човека, докато не я публикуваш.'
                                      : 'Черновата е махната. Следващото разпределение може да сложи друга.'
                                )
                                setMessage(text)
                                load(text)
                              }
                            }).catch(() => {
                              setSaving(false)
                              setMessage('Не се запази. Опитай пак.')
                            })
                          }}
                        >
                          <input
                            name="section"
                            className="min-h-11 w-32 rounded-xl border-2 border-[#4a314f] bg-white px-2 text-[#1a1020]"
                            value={draftValues[person.id] ?? person.draftSection}
                            onChange={(event) => setDraftValues((current) => ({ ...current, [person.id]: event.target.value }))}
                            aria-label={`Чернова за ${person.email}`}
                          />
                          <button className={adminGhost} type="submit" disabled={saving}>
                            {saving ? 'Записваме…' : 'Запази'}
                          </button>
                        </form>
                        {warnings.length > 0 ? (
                          <ul className="grid gap-1 text-xs font-semibold">
                            {warnings.map((warning) => (
                              // Only a blocking warning is red; a soft note (МИР outside the person's places) is an amber hint.
                              <li
                                key={warning.code + warning.message}
                                data-level={warning.level}
                                className={warning.level === 'block' ? 'text-[#a33]' : 'rounded bg-[#fdf3d8] px-1 text-[#5c4300]'}
                              >
                                {warning.message}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ) : (
                      person.draftSection
                    )}
                  </td>
                  <td className="py-3 pr-3">
                    <SectionWhere spot={spotFor(draftCode, spots)} />
                  </td>
                  <td className="whitespace-nowrap py-3 pr-3">
                    <p>{person.publishedSection || '—'}</p>
                    {priorityOf(person.publishedSection, priority) ? (
                      <p className="mt-1"><PriorityBadge info={priorityOf(person.publishedSection, priority)} /></p>
                    ) : null}
                    {reservedOrgFor(person.publishedSection, reserved) ? (
                      <p className="mt-1"><ReservedBadge org={reservedOrgFor(person.publishedSection, reserved)} conflict /></p>
                    ) : null}
                    {canPublish ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {pendingDraft ? (
                          <button
                            type="button"
                            className="min-h-10 text-sm font-bold"
                            disabled={busy}
                            onClick={() => {
                              setBusy(true)
                              void publish(person.id).finally(() => setBusy(false))
                            }}
                          >
                            {person.publishedSection ? `Публикувай ${person.draftSection}` : 'Публикувай'}
                          </button>
                        ) : null}
                        {person.publishedSection ? (
                          <>
                            <button
                              type="button"
                              className="min-h-10 text-sm font-bold text-[#8f1d1d]"
                              disabled={busy}
                              onClick={() => {
                                if (!armedUnpublish) {
                                  setArmedUnpublish(true)
                                  return
                                }
                                setArmedUnpublish(false)
                                setBusy(true)
                                void unpublish(person.id).then((result) => {
                                  setBusy(false)
                                  setMessage(result.message)
                                  if (result.ok) load(result.message)
                                }).catch(() => setBusy(false))
                              }}
                            >
                              {armedUnpublish ? 'Да, махни публикуването' : 'Махни публикуването'}
                            </button>
                            <button
                              type="button"
                              className="min-h-10 text-sm font-bold"
                              onClick={() => {
                                void notifyAgain(person.id).then((result) => setMessage(result.message))
                              }}
                            >
                              Извести по имейл
                            </button>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </td>
                  <td className="py-3 pr-3">
                    <SectionWhere spot={spotFor(person.publishedSection, spots)} />
                  </td>
                </tr>
  )
}

function priorityOf(code: string, priority: Record<string, PriorityInfo>) {
  const digits = code.replace(/\D/g, '')
  return digits.length === 9 ? priority[digits] ?? null : null
}

function spotFor(code: string, spots: Record<string, SectionSpot>) {
  const digits = code.replace(/\D/g, '')
  if (digits.length !== 9) return null
  return spots[digits] ?? sectionSpot(digits, EMPTY_SECTION_DIRECTORY)
}

function SectionWhere({ spot }: { spot: SectionSpot | null }) {
  if (!spot || (!spot.address && !spot.area)) return <>—</>
  return (
    <div className="min-w-52 max-w-sm">
      {spot.address ? <p className="font-bold">{spot.address}</p> : null}
      {spot.area ? <p className="text-[#333]">{spot.area}</p> : null}
    </div>
  )
}
