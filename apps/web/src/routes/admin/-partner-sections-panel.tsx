import { useEffect, useState } from 'react'
import { adminGhost, adminInput } from '../../components/admin-ui'
import { EgnReveal } from '../../components/EgnReveal'
import type { PriorityInfo } from '../../signup/priority-sections'
import {
  adminPartnerDistribute,
  adminPartnerPublish,
  adminPartnerSave,
  adminPartnerSections,
  adminPartnerUnpublish,
} from '../../signup/partner-sections-admin'
import { PriorityBadge } from './-priority-badge'

type PartnerRow = {
  id: string
  name: string
  mir: string
  number: number | null
  municipality: string
  draft: string
  published: string
  locked: boolean
  source: string
  draftPriority: PriorityInfo | null
  publishedPriority: PriorityInfo | null
  hasEgn: boolean
}
type Counts = { total: number; drafted: number; published: number; waiting: number }

async function withRetry<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run()
    } catch (error) {
      if (attempt >= attempts) throw error
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt))
    }
  }
}

/**
 * Секции → „И аз“ — секции. Partner people get sections like signups, but publishing only sets the
 * section and the „И аз“ reservation: no email, no Brevo, no profile, no login.
 */
export function PartnerSectionsPanel({
  canEdit,
  canPublish,
  canRevealEgn = false,
  setMessage,
}: {
  canEdit: boolean
  canPublish: boolean
  canRevealEgn?: boolean
  setMessage: (message: string) => void
}) {
  const [rows, setRows] = useState<PartnerRow[]>([])
  const [counts, setCounts] = useState<Counts>({ total: 0, drafted: 0, published: 0, waiting: 0 })
  const [version, setVersion] = useState(0)
  const [busy, setBusy] = useState(false)
  const [armed, setArmed] = useState<'draft' | 'publish' | null>(null)
  const [preview, setPreview] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})

  useEffect(() => {
    let live = true
    // A read: retried on a thrown call (a transient 500), so one hiccup does not leave the list empty.
    void withRetry(() => adminPartnerSections())
      .then((result) => {
        if (!live || !result.ok) return
        setRows(result.people as PartnerRow[])
        setCounts(result.counts)
      })
      .catch(() => setMessage('„И аз“ — секциите не се заредиха.'))
    return () => {
      live = false
    }
  }, [version, setMessage])

  const reload = () => setVersion((value) => value + 1)
  function after(result: { ok: boolean; message?: string }) {
    setBusy(false)
    if (result.message) setMessage(result.message)
    reload()
  }

  function distribute(dryRun: boolean) {
    setBusy(true)
    void adminPartnerDistribute({ data: { dryRun } })
      .then((result) => {
        setBusy(false)
        if (result.message) setMessage(result.message)
        if (dryRun) setPreview(result.message ?? '')
        else {
          setPreview('')
          reload()
        }
      })
      .catch(() => {
        setBusy(false)
        setMessage('Черновите за „И аз“ не се записаха. Опитай пак.')
      })
  }

  const pending = rows.filter((row) => row.draft && row.draft !== row.published).length
  return (
    <details className="rounded-2xl border-2 border-[#5b2a86] bg-white p-3" data-testid="partner-sections-panel">
      <summary className="cursor-pointer text-sm font-bold text-[#1a1020]">
        „И аз“ — секции: {counts.total} души · чернови {counts.drafted} · публикувани {counts.published} · без секция {counts.waiting}
      </summary>
      <div className="mt-3 grid gap-3 text-sm text-[#1a1020]">
        <p>
          Хората от „И аз“ остават в МИР-а от пълномощното. Черновата е в общината им (ако е посочена), иначе в МИР-а: първо приоритетни секции по R, после хартиени.
          Заети, резервирани и мобилни цели не влизат. Публикуването само записва секцията и я резервира като „И аз“: без имейл, без Brevo, без профил и без вход.
        </p>
        <div className="flex flex-wrap gap-2">
          {canEdit ? (
            <>
              <button type="button" className={adminGhost} disabled={busy} onClick={() => distribute(true)}>
                Преглед за „И аз“
              </button>
              <button
                type="button"
                className={armed === 'draft' ? 'brand-button w-auto px-6' : adminGhost}
                disabled={busy}
                data-testid="partner-sections-distribute"
                onClick={() => {
                  if (armed !== 'draft') return setArmed('draft')
                  setArmed(null)
                  distribute(false)
                }}
              >
                {busy ? 'Смятаме…' : armed === 'draft' ? 'Да, чернови само за хората без секция' : 'Чернови за „И аз“'}
              </button>
            </>
          ) : null}
          {canPublish && pending ? (
            <button
              type="button"
              className={armed === 'publish' ? 'brand-button w-auto px-6' : adminGhost}
              disabled={busy}
              data-testid="partner-sections-publish-all"
              onClick={() => {
                if (armed !== 'publish') return setArmed('publish')
                setArmed(null)
                setBusy(true)
                void adminPartnerPublish({ data: {} }).then(after).catch(() => after({ ok: false, message: 'Публикуването не мина.' }))
              }}
            >
              {armed === 'publish' ? `Да, публикувай ${pending} (резервация „И аз“, без писма)` : `Публикувай всички ${pending}`}
            </button>
          ) : null}
        </div>
        {preview ? <p className="rounded-xl bg-[#f3eefa] p-2 font-bold" data-testid="partner-sections-preview">{preview}</p> : null}
        {rows.length ? (
          <div className="max-h-[36rem] overflow-auto">
            <table className="w-full min-w-[900px] text-left text-sm" data-testid="partner-sections-table">
              <thead>
                <tr className="border-b-2 border-[#2b062f]">
                  <th className="px-2 py-2">МИР / №</th>
                  <th className="px-2 py-2">Име</th>
                  <th className="px-2 py-2">Община</th>
                  <th className="px-2 py-2">Чернова</th>
                  <th className="px-2 py-2">Публикувана</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-[#eee] align-top" data-testid="partner-section-row">
                    <td className="px-2 py-2 font-mono text-xs">
                      {row.mir || '—'}
                      {row.number ? ` / ${row.number}` : ''}
                    </td>
                    <td className="grid gap-1 px-2 py-2">
                      <span>{row.name}</span>
                      {canRevealEgn ? <EgnReveal personId={row.id} hasEgn={row.hasEgn} canReveal compact /> : null}
                    </td>
                    <td className="px-2 py-2">{row.municipality || '—'}</td>
                    <td className="grid gap-1 px-2 py-2">
                      <span className="font-mono">{row.draft || '—'}</span>
                      <PriorityBadge info={row.draftPriority} />
                      {row.draft && row.locked ? <span className="text-xs">ръчна</span> : null}
                      {canEdit ? (
                        <span className="flex flex-wrap items-center gap-1">
                          <input
                            className={`${adminInput} w-32 font-mono`}
                            value={values[row.id] ?? row.draft}
                            onChange={(event) => setValues((prev) => ({ ...prev, [row.id]: event.target.value }))}
                            aria-label="Секция"
                          />
                          <button
                            type="button"
                            className={adminGhost}
                            onClick={() =>
                              // „Запази“ only saves a manual draft: no publishing, no email.
                              void adminPartnerSave({ data: { id: row.id, section: values[row.id] ?? row.draft } })
                                .then(after)
                                .catch(() => after({ ok: false, message: 'Не се запази.' }))
                            }
                          >
                            Запази
                          </button>
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 py-2">
                      <span className="font-mono">{row.published || '—'}</span>
                      <PriorityBadge info={row.publishedPriority} />
                    </td>
                    <td className="px-2 py-2">
                      {canPublish && row.draft && row.draft !== row.published ? (
                        <button
                          type="button"
                          className="text-xs font-bold underline"
                          onClick={() => void adminPartnerPublish({ data: { ids: [row.id] } }).then(after)}
                        >
                          Публикувай
                        </button>
                      ) : null}
                      {canPublish && row.published ? (
                        <button type="button" className="ml-2 text-xs font-bold text-[#8f1d1d] underline" onClick={() => void adminPartnerUnpublish({ data: { id: row.id } }).then(after)}>
                          Махни публикуването
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>Няма хора от „И аз“.</p>
        )}
      </div>
    </details>
  )
}
