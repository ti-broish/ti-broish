import { Link } from '@tanstack/react-router'
import type { AssignWarning } from '../../signup/admin-assign'
import type { RosterFields } from '../../signup/admin-csv'
import { adminDraft } from '../../signup/admin-assign-actions'
import { adminSuggest } from '../../signup/admin-suggest'
import { addressDeskLine, deskLabel } from '../../signup/sections'
import { EMPTY_SECTION_DIRECTORY, sectionSpot, signupSpot, type SectionSpot } from '../../signup/section-where'

type Suggestion = { id: string; place: string; score: number; reason: string; desk: 'paper' | 'machine' | 'unknown' }

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
  tips: Suggestion[]
  setSuggestions: (updater: (current: Record<string, Suggestion[]>) => Record<string, Suggestion[]>) => void
  suggestBusy: string | null
  setSuggestBusy: (id: string | null) => void
  setMessage: (message: string) => void
  load: () => void
  canPublish: boolean
  publishOne: (id: string) => Promise<{ ok: boolean; message: string }>
  notifyAgain: (id: string) => Promise<{ ok: boolean; message: string }>
  spots: Record<string, SectionSpot>
}) {
  const {
    person, canEdit, draftValues, setDraftValues, warnings, setRowWarnings,
    tips, setSuggestions, suggestBusy, setSuggestBusy, setMessage, load,
    canPublish, publishOne, notifyAgain, spots,
  } = props
  const pendingDraft = Boolean(person.draftSection && person.draftSection !== person.publishedSection)
  const signed = signupSpot(person)
  const draftCode = draftValues[person.id] ?? person.draftSection
  return (
                <tr className="border-b border-[#eee] align-top">
                  <td className="py-3 pr-3">
                    <p>
                      <Link to="/admin/signups/$personId" params={{ personId: person.id }} className="font-bold text-[#2b062f] underline">
                        {[person.firstName, person.lastName].filter(Boolean).join(' ') || '—'}
                      </Link>
                    </p>
                    <p>{person.email}</p>
                    {addressDeskLine(person.paperCount, person.machineCount) ? (
                      <p className="text-xs font-bold text-[#1a1020]">{addressDeskLine(person.paperCount, person.machineCount)}</p>
                    ) : null}
                  </td>
                  <td className="py-3 pr-3">
                    <p>{signed.oblast || '—'}</p>
                    {person.region === '32' ? <p className="text-xs text-[#333]">чужбина</p> : person.mir ? <p className="text-xs text-[#333]">МИР {person.mir}</p> : null}
                  </td>
                  <td className="py-3 pr-3">{signed.municipality || '—'}</td>
                  <td className="py-3 pr-3">{signed.town || '—'}</td>
                  <td className="py-3 pr-3">{signed.district || '—'}</td>
                  <td className="max-w-xs py-3 pr-3">{signed.address || '—'}</td>
                  <td className="max-w-xs py-3 pr-3">{signed.reach || '—'}</td>
                  <td className="whitespace-nowrap py-3 pr-3">
                    {person.draftSection && person.draftLocked ? (
                      <p className="mb-1 text-xs font-bold text-[#1a1020]">Запазена корекция. Следващото разпределение я държи.</p>
                    ) : null}
                    {canEdit ? (
                      <div className="grid gap-2">
                        <form
                          className="flex flex-wrap gap-2"
                          onSubmit={(event) => {
                            event.preventDefault()
                            const section = draftValues[person.id] ?? ''
                            void adminDraft({ data: { id: person.id, section } }).then((result) => {
                              if (!result.ok) setMessage(result.message)
                              else {
                                setRowWarnings((current) => ({ ...current, [person.id]: result.warnings ?? [] }))
                                setMessage(
                                  result.warning
                                    ? result.blockedOnPublish
                                      ? `Черновата е запазена, но няма да се публикува: ${result.warning}`
                                      : result.warning
                                    : section.trim()
                                      ? 'Черновата е запазена и не се вижда от човека. Следващото разпределение я запазва.'
                                      : 'Черновата е изчистена. Следващото разпределение може да сложи друга.',
                                )
                                load()
                              }
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
                          <button className="text-sm font-bold" type="submit">Запази</button>
                          <button
                            className="text-sm font-bold"
                            type="button"
                            disabled={suggestBusy === person.id}
                            onClick={() => {
                              setSuggestBusy(person.id)
                              void adminSuggest({ data: { id: person.id } }).then((result) => {
                                setSuggestBusy(null)
                                if (!result.ok) {
                                  setMessage(result.message)
                                  return
                                }
                                setSuggestions((current) => ({ ...current, [person.id]: result.suggestions }))
                                if (result.message) setMessage(result.message)
                              })
                            }}
                          >
                            {suggestBusy === person.id ? 'Търся…' : 'Предложи'}
                          </button>
                        </form>
                        {warnings.length > 0 ? (
                          <ul className="grid gap-1 text-xs font-semibold text-[#a33]">
                            {warnings.map((warning) => (
                              <li key={warning.code + warning.message}>{warning.message}</li>
                            ))}
                          </ul>
                        ) : null}
                        {tips.length > 0 ? (
                          <ul className="grid gap-1">
                            {tips.map((tip) => (
                              <li key={tip.id}>
                                <button
                                  type="button"
                                  className="text-left text-xs font-bold text-[#135]"
                                  onClick={() => {
                                    setDraftValues((current) => ({ ...current, [person.id]: tip.id }))
                                    void adminDraft({ data: { id: person.id, section: tip.id } }).then((result) => {
                                      if (!result.ok) setMessage(result.message)
                                      else {
                                        setRowWarnings((current) => ({ ...current, [person.id]: result.warnings ?? [] }))
                                        setMessage(result.warning || `Чернова ${tip.id} от предложение. Следващото разпределение я запазва.`)
                                        load()
                                      }
                                    })
                                  }}
                                >
                                  <span className="mr-2 inline-flex align-middle"><DeskBadge desk={tip.desk} /></span>
                                  {tip.id}
                                  <span className="font-normal text-[#333]"> — {tip.place || tip.reason}</span>
                                </button>
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
                    {canPublish ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {pendingDraft ? (
                          <button
                            type="button"
                            className="min-h-10 text-sm font-bold"
                            onClick={() => {
                              void publishOne(person.id).then((result) => {
                                setMessage(result.message)
                                if (result.ok) load()
                              })
                            }}
                          >
                            Публикувай и извести
                          </button>
                        ) : person.publishedSection ? (
                          <button
                            type="button"
                            className="min-h-10 text-sm font-bold"
                            onClick={() => {
                              void notifyAgain(person.id).then((result) => setMessage(result.message))
                            }}
                          >
                            Извести пак
                          </button>
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
