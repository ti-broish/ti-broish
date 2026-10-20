import { useEffect, useState } from 'react'
import { adminGhost } from '../../components/admin-ui'
import type { SignedWave } from '../../signup/signed-waves'
import { adminSignedWaves } from '../../signup/signed-waves-admin'

const EXPORT_REASON = 'Нужно е право за експорт (редактор или админ).'

/**
 * Подписани по вълни: each wave (one Sofia day of first signed uploads) downloads as a ZIP with
 * one folder per РИК — „РИК NN Представители.xlsx“ and that РИК's signed PDFs.
 */
export function SignedWavesPanel({ canExport, refreshKey }: { canExport: boolean; refreshKey: number }) {
  const [waves, setWaves] = useState<SignedWave[]>([])
  const [total, setTotal] = useState(0)
  const [mirs, setMirs] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!canExport) return
    let live = true
    void adminSignedWaves()
      .then((result) => {
        if (!live) return
        if (!result.ok) {
          setError(result.message)
          return
        }
        setError('')
        setWaves(result.waves)
        setTotal(result.total)
        setMirs(result.mirs)
      })
      .catch(() => live && setError('Вълните не се заредиха.'))
    return () => {
      live = false
    }
  }, [canExport, refreshKey])

  return (
    <section aria-labelledby="palnomoshtni-waves" className="grid gap-3 rounded-2xl border-2 border-[#2b062f] bg-white p-4" data-testid="signed-waves">
      <h2 id="palnomoshtni-waves" className="text-lg font-black text-[#1a1020]">
        Подписани по вълни → РИК
      </h2>
      <p className="text-sm text-[#333]">
        Вълна = денят (по софийско време), в който подписаното пълномощно е качено за първи път; повторно качване не мести човека. Всеки ZIP има папка за всеки РИК с
        таблица „РИК NN Представители.xlsx“ (форматът от миналите избори) и подписаните PDF-и. Включени са записаните и „И аз“.
      </p>
      {!canExport ? <p className="text-sm font-bold text-[#8f1d1d]">{EXPORT_REASON}</p> : null}
      {error ? <p className="text-sm font-bold text-[#8f1d1d]">{error}</p> : null}
      {canExport && !error ? (
        <>
          <p className="text-sm font-bold text-[#1a1020]" data-testid="signed-waves-total">
            Подписани общо: {total} · РИК: {mirs} · вълни: {waves.length}
          </p>
          {waves.length === 0 ? <p className="text-sm text-[#333]">Още няма качени подписани пълномощни.</p> : null}
          <ul className="grid gap-2" aria-label="Вълни">
            {waves.map((wave) => (
              <li key={wave.key} className="grid gap-1 rounded-xl border border-[#d8cbe0] p-3">
                <p className="text-sm font-bold text-[#1a1020]">
                  Вълна {wave.wave} · {wave.date} · {wave.count} души{wave.partners ? ` (от тях „И аз“ ${wave.partners})` : ''} · РИК: {wave.mirs.length}
                </p>
                <p className="text-xs text-[#333]">{wave.mirs.map((item) => `${item.mir}: ${item.count}`).join(' · ')}</p>
                <div className="flex flex-wrap gap-2">
                  <a className={adminGhost} href={`/admin/palnomoshtni/podpisani?wave=${wave.key}`}>
                    Изтегли ZIP вълна {wave.wave} (PDF + таблици)
                  </a>
                  <a className={adminGhost} href={`/admin/palnomoshtni/podpisani?wave=${wave.key}&tables=1`}>
                    Само таблиците РИК, вълна {wave.wave}
                  </a>
                </div>
              </li>
            ))}
          </ul>
          {waves.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              <a className={adminGhost} href="/admin/palnomoshtni/podpisani?wave=all">
                Изтегли всички подписани досега (PDF + таблици)
              </a>
              <a className={adminGhost} href="/admin/palnomoshtni/podpisani?wave=all&tables=1">
                Само таблиците РИК, всички досега
              </a>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
