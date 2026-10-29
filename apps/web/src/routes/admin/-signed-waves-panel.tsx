import { useEffect, useState } from 'react'
import { adminGhost } from '../../components/admin-ui'
import { UNSENT_WAVES_KEY, unsentSummary, type SignedWave } from '../../signup/signed-waves'
import { adminCloseSigningWave, adminSignedWaves } from '../../signup/signed-waves-admin'

const EXPORT_REASON = 'Нужно е право за експорт (редактор или админ).'

function sofiaTime(iso: string) {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  return new Intl.DateTimeFormat('bg-BG', { timeZone: 'Europe/Sofia', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(at)
}

function people(count: number) {
  return count === 1 ? '1 човек' : `${count} души`
}

/**
 * Вълни → РИК. A wave is the date printed in the PDF. „Изпратена на РИК“ closes the open wave of
 * that date; later numbers with the same date are the next wave. Each wave downloads as a ZIP
 * with one folder per РИК — „РИК NN Представители.xlsx“ and that РИК's signed PDFs.
 */
export function SignedWavesPanel({ canExport, refreshKey }: { canExport: boolean; refreshKey: number }) {
  const [waves, setWaves] = useState<SignedWave[]>([])
  const [total, setTotal] = useState(0)
  const [mirs, setMirs] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [reload, setReload] = useState(0)
  const [closing, setClosing] = useState('')
  const unsent = unsentSummary(waves)

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
        setLoaded(true)
      })
      .catch(() => live && setError('Вълните не се заредиха.'))
    return () => {
      live = false
    }
  }, [canExport, refreshKey, reload])

  async function close(wave: SignedWave) {
    const ok = window.confirm(
      `${wave.label} е изпратена на РИК? Затваряме я с ${people(wave.count)} (подписаните). Подписаните или номерираните по-късно с дата ${wave.date} ще са нова отворена вълна.`,
    )
    if (!ok) return
    setClosing(wave.key)
    setNotice('')
    try {
      const result = await adminCloseSigningWave({ data: { issueDate: wave.issueKey } })
      if (!result.ok) setError(result.message)
      else setNotice(`Вълната от ${wave.date} е затворена като изпратена на РИК.`)
    } catch {
      setError('Вълната не се затвори. Опитай пак.')
    } finally {
      setClosing('')
      setReload((value) => value + 1)
    }
  }

  return (
    <section aria-labelledby="palnomoshtni-waves" className="grid gap-3 rounded-2xl border-2 border-[#2b062f] bg-white p-4" data-testid="signed-waves">
      <h2 id="palnomoshtni-waves" className="text-lg font-black text-[#1a1020]">
        Подписани по вълни → РИК
      </h2>
      <p className="text-sm text-[#333]">
        Вълна = датата в пълномощното (датата на номера), както е в РИК. „Изпратена на РИК“ затваря отворената вълна само с подписаните;
        подписаните или номерираните след това със същата дата са нова (отворена) вълна, дори за вече изпратена дата. Всеки ZIP има папка за всеки РИК с таблица „РИК NN Представители.xlsx“
        и подписаните PDF-и. Включени са записаните и „И аз“. Отворените вълни са по дата („29.10 · отворена“), затворените пазят номера си.
        „Всички неизпратени“ дава всички отворени вълни в един ZIP с една таблица за всеки РИК.
      </p>
      {!canExport ? <p className="text-sm font-bold text-[#8f1d1d]">{EXPORT_REASON}</p> : null}
      {error ? <p className="text-sm font-bold text-[#8f1d1d]">{error}</p> : null}
      {notice ? <p className="text-sm font-bold text-[#1d6b34]" role="status">{notice}</p> : null}
      {canExport && !error && !loaded ? <p className="text-sm text-[#333]">Зареждаме вълните…</p> : null}
      {canExport && loaded ? (
        <>
          <p className="text-sm font-bold text-[#1a1020]" data-testid="signed-waves-total">
            Подписани общо: {total} · РИК: {mirs} · вълни: {waves.length}
          </p>
          {waves.length === 0 ? <p className="text-sm text-[#333]">Още няма номерирани пълномощни.</p> : null}
          {unsent.count > 0 ? (
            <div className="grid gap-1 rounded-xl border-2 border-[#1d7a3a] p-3" data-testid="signed-waves-unsent">
              <p className="text-sm font-bold text-[#1a1020]">
                Всички неизпратени: {unsent.count} подписани · РИК: {unsent.mirs} · дати: {unsent.dates.join(', ')}
              </p>
              <p className="text-xs text-[#333]">Всички отворени вълни в един ZIP: по една папка и една таблица за всеки РИК, всички дати заедно.</p>
              <div className="flex flex-wrap gap-2">
                <a className={adminGhost} href={`/admin/palnomoshtni/podpisani?wave=${UNSENT_WAVES_KEY}`}>
                  Изтегли всички неизпратени (PDF + таблици)
                </a>
                <a className={adminGhost} href={`/admin/palnomoshtni/podpisani?wave=${UNSENT_WAVES_KEY}&tables=1`}>
                  Само таблиците РИК, всички неизпратени
                </a>
              </div>
            </div>
          ) : null}
          <ul className="grid gap-2" aria-label="Вълни">
            {waves.map((wave) => (
              <li
                key={wave.key}
                className={`grid gap-1 rounded-xl border p-3 ${wave.closed ? 'border-[#d8cbe0]' : 'border-2 border-[#1d7a3a]'}`}
                data-wave={wave.wave}
                data-date={wave.issueKey}
                data-closed={wave.closed ? '1' : '0'}
              >
                <p className="text-sm font-bold text-[#1a1020]">
                  {wave.label}
                  {wave.closed ? ' · ' : null}
                  {wave.closed ? (
                    <span>изпратена на РИК {sofiaTime(wave.closedAt)}{wave.closedBy ? ` (${wave.closedBy})` : ''}</span>
                  ) : null}
                </p>
                <p className="text-sm text-[#1a1020]">
                  Подписани {wave.count} от {wave.total}
                  {wave.partners ? ` (от тях „И аз“ ${wave.partners})` : ''} · РИК: {wave.mirs.length}
                </p>
                <p className="text-xs text-[#333]">{wave.mirs.map((item) => `${item.mir}: ${item.count}`).join(' · ')}</p>
                <div className="flex flex-wrap gap-2">
                  {wave.count > 0 ? (
                    <>
                      <a className={adminGhost} href={`/admin/palnomoshtni/podpisani?wave=${wave.key}`}>
                        Изтегли ZIP {wave.shortLabel} (PDF + таблици)
                      </a>
                      <a className={adminGhost} href={`/admin/palnomoshtni/podpisani?wave=${wave.key}&tables=1`}>
                        Само таблиците РИК, {wave.shortLabel}
                      </a>
                    </>
                  ) : null}
                  {!wave.closed ? (
                    <button type="button" className={adminGhost} disabled={Boolean(closing)} onClick={() => void close(wave)}>
                      {closing === wave.key ? 'Затваряме…' : `Изпратена на РИК — затвори ${wave.shortLabel}`}
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          {total > 0 ? (
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
