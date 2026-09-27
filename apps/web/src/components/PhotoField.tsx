import { useState } from 'react'
import { compressPhoto } from '../signup/photos'
import type { PhotoInput } from '../signup/reports-validate'

export function PhotoField({
  photos,
  onChange,
  minimum = 0,
}: {
  photos: PhotoInput[]
  onChange: (photos: PhotoInput[]) => void
  minimum?: number
}) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function add(list: FileList | null) {
    if (!list?.length) return
    setBusy(true)
    setError('')
    const next = [...photos]
    try {
      for (const file of list) {
        if (next.length >= 8) break
        next.push(await compressPhoto(file))
      }
      onChange(next)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Снимката не се чете.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-3">
      <label className="brand-button relative cursor-pointer">
        {busy ? 'Обработваме снимките…' : 'Добави снимки'}
        <input
          className="photo-input"
          type="file"
          accept="image/*"
          multiple
          disabled={busy}
          onChange={(event) => {
            void add(event.target.files)
            event.target.value = ''
          }}
        />
      </label>
      {minimum > 0 ? (
        <p>
          {photos.length} от поне {minimum} снимки.
        </p>
      ) : (
        <p>{photos.length > 0 ? `${photos.length} снимки.` : 'Снимките са по желание.'}</p>
      )}
      {error ? <p className="text-red-700">{error}</p> : null}
      <ul className="grid gap-3">
        {photos.map((photo, index) => (
          <li key={`${index}-${photo.data.slice(0, 24)}`} className="grid gap-2">
            <img src={`data:image/jpeg;base64,${photo.data}`} alt="" className="max-h-48 w-full rounded-xl object-contain" />
            <button type="button" className="text-left font-bold text-[#2b062f]" onClick={() => onChange(photos.filter((_, item) => item !== index))}>
              Махни снимката
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
