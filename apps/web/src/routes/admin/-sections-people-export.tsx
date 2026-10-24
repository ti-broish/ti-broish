import { useState } from 'react'
import { adminSectionsPeopleExport } from '../../signup/sections-people-export-admin'
import { downloadCsv } from './-brevo-sections-export'

/** „Експорт секции с хора“ (admins): every section with at least one person, ours or „И аз“, live. */
export function SectionsPeopleExportPanel({ setMessage }: { setMessage: (message: string) => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <section aria-labelledby="sections-people-export" className="grid gap-2 rounded-2xl border-2 border-[#0f5f73] bg-[#eef6f8] p-4">
      <h2 id="sections-people-export" className="text-lg font-black text-[#1a1020]">
        Експорт: секции с хора
      </h2>
      <p className="text-sm text-[#333]">
        Само секциите, в които има поне един човек (Ти броиш или „И аз“), по ред на човек: адрес по ЦИК, хартия/машина, приоритет, заета от друга организация, име, телефон, имейл, чернова или публикувана, пълномощно. Цялата страна и чужбина, без ЕГН.
      </p>
      <div>
        <button
          type="button"
          className="brand-button w-auto px-6"
          disabled={busy}
          data-testid="sections-people-export"
          onClick={() => {
            setBusy(true)
            void adminSectionsPeopleExport()
              .then((result) => {
                if (!result.ok) {
                  setMessage(result.message)
                  return
                }
                downloadCsv(result.filename, result.csv)
                setMessage(`„Секции с хора“: ${result.sections} секции, ${result.people} души (Ти броиш ${result.ours}, „И аз“ ${result.partners}), без ЕГН.`)
              })
              .catch(() => setMessage('Експортът не мина. Опитай пак.'))
              .finally(() => setBusy(false))
          }}
        >
          {busy ? 'Експортираме…' : 'Експорт секции с хора'}
        </button>
      </div>
    </section>
  )
}
