import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { adminNumberHistory, adminNumberLookup } from '../../signup/number-lookup-admin'
import { parseNumberQuery, type NumberCard, type PersonRef } from '../../signup/number-lookup'

const BADGE: Record<NumberCard['state'], string> = {
  active: 'bg-[#dff3e9] text-[#145744]',
  moved: 'bg-[#fdf0c4] text-[#5c4300]',
  withdrawn: 'bg-[#ececec] text-[#333]',
  released: 'bg-[#ececec] text-[#333]',
  external: 'bg-[#fbe0e0] text-[#8f1d1d]',
}
const EDGE: Record<NumberCard['state'], string> = {
  active: 'border-l-[#1f8a5b]',
  moved: 'border-l-[#d4a017]',
  withdrawn: 'border-l-[#8a8a8a]',
  released: 'border-l-[#8a8a8a]',
  external: 'border-l-[#a3262a]',
}
const link = 'font-bold text-[#3d2ea8] underline'

function Badge({ card, current }: { card: NumberCard; current?: boolean }) {
  const label = card.state === 'moved' ? 'Преместен' : card.state === 'withdrawn' ? 'Отписан' : card.state === 'released' ? 'Освободен' : card.state === 'external' ? 'Външен (РИК)' : current ? 'текущ' : 'Активен'
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-black ${BADGE[card.state]}`}>{label}</span>
}

function ProfileLink({ person, children }: { person: PersonRef; children: React.ReactNode }) {
  return person.source === 'partner' ? (
    <Link to="/admin/iaz/$personId" params={{ personId: person.id }} className={link}>{children}</Link>
  ) : (
    <Link to="/admin/signups/$personId" params={{ personId: person.id }} className={link}>{children}</Link>
  )
}

function RegisterLink({ mir, url }: { mir: string; url: string }) {
  if (!url) return null
  return (
    <a className={link} href={url} target="_blank" rel="noreferrer">
      Регистър РИК {mir} ↗
    </a>
  )
}

const dot = <span aria-hidden="true"> · </span>
const source = (person: PersonRef) => (person.source === 'partner' ? '„И аз“ профил' : 'профил при нас')
const current = (person: PersonRef) => (person.number != null && person.mir ? `${person.mir}/${person.number}` : '')

/** One number from the ledger, as a card above the people search results. */
export function NumberSearchCard({ card }: { card: NumberCard }) {
  const person = card.person
  return (
    <li className={`grid gap-1 rounded-xl border border-[#d8d0da] border-l-4 bg-white p-3 ${EDGE[card.state]}`} data-testid="number-card">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[#1a1020]">
        <Badge card={card} />
        <span>
          <b>№ {card.label}</b>
          {card.issuedOn ? ` от ${card.issuedOn}` : ''}
          {card.state === 'moved' && card.movedTo ? (
            <>
              {' '}· МИР {card.mir} → <b>{card.movedTo}</b> · номерът остава изгорял
            </>
          ) : null}
          {card.state === 'external' && card.external?.name ? <> · {card.external.name}</> : null}
          {card.state === 'external' && !card.external?.name ? <> · „Анулиран“ (без име)</> : null}
          {person && card.state !== 'moved' ? <> · {person.name || '—'}</> : null}
        </span>
      </p>
      <p className="text-sm text-[#4a3f4d]">
        {card.state === 'external' ? (
          <>
            Публикуван от РИК {card.mir} под нашата коалиция, не е в нашата база · номерът е запазен{dot}
            <RegisterLink mir={card.mir} url={card.external?.url || card.register.url} />
          </>
        ) : person ? (
          <>
            Носител: {person.name ? <strong className="font-semibold">{person.name}</strong> : null}
            {person.name ? ' · ' : null}
            {source(person)}
            {card.state === 'moved' && current(person) ? (
              <>
                {dot}сега{' '}
                <ProfileLink person={person}>{current(person)} → Отвори профила</ProfileLink>
              </>
            ) : (
              <>
                {dot}
                <ProfileLink person={person}>Профил</ProfileLink>
              </>
            )}
            {dot}
            {card.register.label}
            {card.register.url ? (
              <>
                {dot}
                <RegisterLink mir={card.mir} url={card.register.url} />
              </>
            ) : null}
          </>
        ) : (
          <>{card.register.label}</>
        )}
      </p>
      {card.external && card.state !== 'external' ? (
        <p className="text-sm text-[#8f1d1d]">
          Зает външно: РИК {card.mir} го показва за „{card.external.name}“{dot}
          <RegisterLink mir={card.mir} url={card.external.url} />
        </p>
      ) : null}
    </li>
  )
}

/** The cards for a „23/514“ or „514“ query; nothing for any other query (the normal search runs as before). */
export function NumberSearchCards({ q }: { q: string }) {
  const query = parseNumberQuery(q)
  const [state, setState] = useState<{ q: string; cards: NumberCard[]; message: string } | null>(null)
  useEffect(() => {
    if (!query) return setState(null)
    let cancelled = false
    void adminNumberLookup({ data: { q } })
      .then((result) => {
        if (cancelled) return
        setState(result.ok ? { q, cards: result.cards, message: '' } : { q, cards: [], message: result.message })
      })
      .catch(() => !cancelled && setState({ q, cards: [], message: 'Търсенето по номер не се зареди.' }))
    return () => {
      cancelled = true
    }
  }, [q])
  if (!query || !state || state.q !== q) return null
  const what = query.mir ? `№ ${query.mir}/${query.number}` : `№ ${query.number} (всички МИР)`
  return (
    <section className="grid gap-2" aria-label="Търсене по номер">
      <h2 className="text-sm font-black text-[#1a1020]">Номер на пълномощно: {what}</h2>
      {state.message ? <p className="text-sm font-bold text-[#8f1d1d]">{state.message}</p> : null}
      {!state.message && state.cards.length === 0 ? <p className="text-sm text-[#333]">Този номер не е издаван и не е в регистъра на РИК.</p> : null}
      <ul className="grid gap-2">
        {state.cards.map((card) => (
          <NumberSearchCard key={card.label} card={card} />
        ))}
      </ul>
    </section>
  )
}

/** „История на номера“ on a person's admin profile. */
export function NumberHistory({ personId, reloadKey = 0 }: { personId: string; reloadKey?: number }) {
  const [cards, setCards] = useState<NumberCard[] | null>(null)
  const [message, setMessage] = useState('')
  useEffect(() => {
    let cancelled = false
    void adminNumberHistory({ data: { personId } })
      .then((result) => {
        if (cancelled) return
        if (result.ok) {
          setCards(result.cards)
          setMessage('')
        } else setMessage(result.message)
      })
      .catch(() => !cancelled && setMessage('Историята на номера не се зареди.'))
    return () => {
      cancelled = true
    }
  }, [personId, reloadKey])
  return (
    <section className="grid gap-2" aria-labelledby="number-history">
      <h2 id="number-history" className="text-lg font-black text-[#1a1020]">
        История на номера
      </h2>
      {message ? <p className="text-sm font-bold text-[#8f1d1d]">{message}</p> : null}
      {cards && cards.length === 0 ? <p className="text-sm text-[#333]">Няма издаден номер на пълномощно.</p> : null}
      {cards && cards.length ? (
        <ol className="relative grid gap-3 border-l-2 border-[#1a1020] pl-4" data-testid="number-history">
          {cards.map((card) => (
            <li key={card.label} className="relative grid gap-0.5">
              <span
                aria-hidden="true"
                className={`absolute -left-[1.4rem] top-1.5 h-3 w-3 rounded-full ${card.state === 'moved' ? 'bg-[#d4a017]' : card.state === 'active' ? 'bg-[#1a1020]' : 'bg-[#8a8a8a]'}`}
              />
              <p className="flex flex-wrap items-center gap-2 text-[#1a1020]">
                <span>
                  <b>{card.label}</b>
                  {card.issuedOn ? ` от ${card.issuedOn}` : ''}
                </span>
                <Badge card={card} current />
              </p>
              <p className="text-sm text-[#4a3f4d]">
                {historyLine(card)}
                {card.register.url ? (
                  <>
                    {dot}
                    <RegisterLink mir={card.mir} url={card.register.url} />
                  </>
                ) : null}
              </p>
              {card.external ? (
                <p className="text-sm text-[#8f1d1d]">
                  Зает външно: РИК {card.mir} го показва за „{card.external.name}“{dot}
                  <RegisterLink mir={card.mir} url={card.external.url} />
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  )
}

function historyLine(card: NumberCard) {
  const parts: string[] = []
  if (card.state === 'moved' && card.movedTo) {
    const [toMir] = card.movedTo.split('/')
    parts.push(toMir && toMir !== card.mir ? `МИР ${card.mir} → ${toMir} (${card.movedTo})` : `нов номер ${card.movedTo}`)
  }
  if (card.state === 'withdrawn') parts.push('отписан, номерът остава запазен')
  if (card.state === 'released') parts.push('номерът е изчистен, остава изгорял')
  if (card.state === 'active' && card.person?.signedAt) parts.push(`Подписан ${shortDate(card.person.signedAt)}`)
  parts.push(card.register.label)
  return parts.join(' · ')
}

function shortDate(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat('bg-BG', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Sofia' }).format(date).replace(/\.$/, '')
}
