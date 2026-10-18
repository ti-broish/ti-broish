import { useState } from 'react'
import { adminExport } from '../../signup/admin'
import { BREVO_SECTIONS_BUTTON, BREVO_SECTIONS_HINT } from '../../signup/brevo-sections-export'

/** Same server export as /admin/signups → Инструменти, with the caller's filters. */
export function exportBrevoSections(filters: { view: string; mir: string; q: string }, setMessage: (message: string) => void) {
  return adminExport({ data: { ...filters, kind: 'brevo-sections' } }).then((result) => {
    if (!result.ok) setMessage(result.message)
    else downloadCsv(result.filename, result.csv)
  })
}

export function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function BrevoSectionsExportPanel(props: {
  filters: { view: string; mir: string; q: string }
  scopeLabel: string
  setMessage: (message: string) => void
}) {
  const [busy, setBusy] = useState(false)
  return (
    <section aria-labelledby="brevo-sections-export" className="grid gap-2 rounded-2xl border-2 border-[#2b062f] bg-[#f6f1f7] p-4">
      <h2 id="brevo-sections-export" className="text-lg font-black text-[#1a1020]">
        Brevo: секции и адреси
      </h2>
      <p className="text-sm text-[#333]">{BREVO_SECTIONS_HINT}</p>
      <p className="text-sm font-bold text-[#1a1020]">{props.scopeLabel}</p>
      <div>
        <button
          type="button"
          className="brand-button w-auto px-6"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void exportBrevoSections(props.filters, props.setMessage)
              .catch(() => props.setMessage('CSV файлът не се изтегли. Опитай пак.'))
              .finally(() => setBusy(false))
          }}
        >
          {busy ? 'Подготвяме CSV…' : BREVO_SECTIONS_BUTTON}
        </button>
      </div>
    </section>
  )
}
