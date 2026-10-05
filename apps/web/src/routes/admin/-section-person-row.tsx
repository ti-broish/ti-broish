import type { AssignWarning } from '../../signup/admin-assign'
import type { RosterFields } from '../../signup/admin-csv'
import { adminDraft } from '../../signup/admin-assign-actions'
import { adminSuggest } from '../../signup/admin-suggest'
import { addressDeskLine, deskLabel } from '../../signup/sections'

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
}) {
  const {
    person, canEdit, draftValues, setDraftValues, warnings, setRowWarnings,
    tips, setSuggestions, suggestBusy, setSuggestBusy, setMessage, load,
    canPublish, publishOne, notifyAgain,
  } = props
  const pendingDraft = Boolean(person.draftSection && person.draftSection !== person.publishedSection)
  return (
                <tr className="border-b border-[#eee] align-top">
                  <td className="py-3 pr-3">
                    <p className="font-bold">{person.firstName} {person.lastName}</p>
                    <p>{person.email}</p>
                    <p className="text-[#333]">{person.mir || (person.region === '32' ? 'чужбина' : person.place)}</p>
                    {addressDeskLine(person.paperCount, person.machineCount) ? (
                      <p className="text-xs font-bold text-[#1a1020]">{addressDeskLine(person.paperCount, person.machineCount)}</p>
                    ) : null}
                    {person.radius || person.travelLabel ? (
                      <p className="text-xs text-[#333]">
                        {person.radius ? `радиус: ${person.radius}` : null}
                        {person.radius && person.travelLabel ? ' · ' : null}
                        {person.travelLabel ? `пътуване: ${person.travelLabel}` : null}
                      </p>
                    ) : null}
                  </td>
                  <td className="py-3 pr-3">
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
                                    : 'Черновата е запазена и не се вижда от човека.',
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
                                        setMessage(result.warning || `Чернова ${tip.id} от предложение.`)
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
                  <td className="py-3">
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
                </tr>
  )
}
