import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { PageIntro } from '../components/SiteChrome'
import { confirmImported, previewImport } from '../signup/confirm-mail'

export const Route = createFileRoute('/potvardi')({
  validateSearch: (search: Record<string, unknown>): { token: string } => ({
    token: typeof search.token === 'string' ? search.token : '',
  }),
  component: ConfirmImportedPage,
})

function ConfirmImportedPage() {
  const { token } = Route.useSearch()
  const navigate = useNavigate()
  const [preview, setPreview] = useState<{ ok: boolean; firstName?: string; email?: string; confirmed?: boolean } | null>(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    void previewImport({ data: { token } }).then((result) => {
      if (!cancelled) setPreview(result.ok ? result : { ok: false })
    })
    return () => {
      cancelled = true
    }
  }, [token])

  if (!preview) return <p>Зареждаме линка…</p>
  if (!preview.ok) {
    return (
      <div>
        <PageIntro title="Линкът не е валиден" lede="Поискай нов от човека, който те е записал." />
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      <PageIntro
        title={preview.firstName ? `${preview.firstName}, потвърди данните` : 'Потвърди данните'}
        lede="Екипът те записа като пазител на вота. След потвърждението можеш да видиш и да промениш данните си."
      />
      <p>{preview.email}</p>
      {message ? <p className="text-sm text-red-700">{message}</p> : null}
      <button
        type="button"
        className="brand-button"
        onClick={() => {
          void confirmImported({ data: { token } }).then(async (result) => {
            if (!result.ok) {
              setMessage(result.message)
              return
            }
            await navigate({ to: '/profil' })
          })
        }}
      >
        Потвърди и отвори профила
      </button>
    </div>
  )
}
