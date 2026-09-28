import { adminImportTaken } from '../../signup/admin'

export function TakenSectionsPanel(props: {
  canEdit: boolean
  taken: Array<{ section_code: string; mir_code: string; place: string; organisation: string }>
  setMessage: (message: string) => void
  load: () => void
}) {
  const { canEdit, taken, setMessage, load } = props
  if (!canEdit) return null
  return (
    <section className="grid gap-3 border-t-2 border-[#2b062f] pt-6">
      <h2 className="text-xl font-black text-[#1a1020]">Заети секции</h2>
      <p>Секции, взети от друга организация. Колони: секция, организация, място, мир, бележка.</p>
      <input
        className="min-h-11 w-full rounded-xl border-2 border-[#4a314f] bg-white px-3 text-[#1a1020]"
        type="file"
        accept=".csv,text/csv"
        aria-label="CSV със заети секции"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          void file.text().then((csv) => adminImportTaken({ data: { csv } })).then((result) => {
            if (!result.ok) setMessage(result.message)
            else {
              setMessage(`Записани са ${result.imported} заети секции.`)
              load()
            }
          })
        }}
      />
      <ul className="grid gap-2 text-sm">
        {taken.map((row) => (
          <li key={row.section_code}>{row.section_code} · {row.organisation}{row.place ? ` · ${row.place}` : ''}{row.mir_code ? ` · МИР ${row.mir_code}` : ''}</li>
        ))}
      </ul>
    </section>
  )
}
