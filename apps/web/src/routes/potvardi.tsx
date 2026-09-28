import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { PageIntro } from '../components/SiteChrome'
import { confirmCompanion, previewCompanion } from '../signup/companion-confirm'
import { confirmImported, previewImport } from '../signup/confirm-mail'

export const Route = createFileRoute('/potvardi')({
  validateSearch: (search: Record<string, unknown>): { token: string; companion: string } => ({
    token: typeof search.token === 'string' ? search.token : '',
    companion: typeof search.companion === 'string' ? search.companion : '',
  }),
  component: ConfirmImportedPage,
})

function ConfirmImportedPage() {
  const { token, companion } = Route.useSearch()
  const navigate = useNavigate()
  const [preview, setPreview] = useState<{
    ok: boolean
    firstName?: string
    email?: string
    confirmed?: boolean
    kind?: 'import' | 'companion'
  } | null>(null)
  const [message, setMessage] = useState('')
  const companionToken = companion.trim()
  const importToken = token.trim()

  useEffect(() => {
    let cancelled = false
    if (companionToken) {
      void previewCompanion({ data: { token: companionToken } }).then((result) => {
        if (!cancelled) setPreview(result.ok ? { ...result, kind: 'companion' } : { ok: false })
      })
      return () => {
        cancelled = true
      }
    }
    void previewImport({ data: { token: importToken } }).then((result) => {
      if (!cancelled) setPreview(result.ok ? { ...result, kind: 'import' } : { ok: false })
    })
    return () => {
      cancelled = true
    }
  }, [companionToken, importToken])

  if (!preview) return <p>Зареждаме линка…</p>
  if (!preview.ok) {
    return (
      <div>
        <PageIntro title="Линкът не е валиден" lede="Поискай нов от човека, който те е записал." />
      </div>
    )
  }

  const isCompanion = preview.kind === 'companion'
  return (
    <div className="grid gap-4">
      <PageIntro
        title={preview.firstName ? `${preview.firstName}, потвърди данните` : 'Потвърди данните'}
        lede={
          isCompanion
            ? 'Поканиха те в група за пазене на вота. След потвърждението организаторът вижда, че си в групата.'
            : 'Екипът те записа като пазител на вота. След потвърждението можеш да видиш и да промениш данните си.'
        }
      />
      <p>{preview.email}</p>
      {preview.confirmed ? <p>{isCompanion ? 'Участието е потвърдено. Можеш да затвориш тази страница.' : 'Този имейл вече е потвърден.'}</p> : null}
      {message ? <p className="text-sm text-red-700">{message}</p> : null}
      {preview.confirmed ? null : (
      <button
        type="button"
        className="brand-button"
        onClick={() => {
          if (isCompanion) {
            void confirmCompanion({ data: { token: companionToken } }).then((result) => {
              if (!result.ok) {
                setMessage(result.message)
                return
              }
              setMessage('')
              setPreview({ ...preview, confirmed: true })
            })
            return
          }
          void confirmImported({ data: { token: importToken } }).then(async (result) => {
            if (!result.ok) {
              setMessage(result.message)
              return
            }
            await navigate({ to: '/profil' })
          })
        }}
      >
        {isCompanion ? 'Потвърди участието' : 'Потвърди и отвори профила'}
      </button>
      )}
    </div>
  )
}
