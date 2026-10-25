import { useEffect, useState } from 'react'
import { evideoUrl } from '../../home/results'
import { recaptchaToken } from '../../signup/recaptcha'
import { rememberReport } from '../../signup/report-memory'
import { sendVideoViolation } from '../../signup/violation-api'

// results: units/Section.js VideoPanel — the official stream on evideo.bg and a short signal about it.

const STORAGE_KEY = 'violationContact'
const PHONE_LOCAL = /^0[1-9][0-9]{8}$/
const PHONE_INTL = /^0{0,2}359[1-9][0-9]{8}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const validPhone = (phone: string) => /^\+(?:[0-9] ?){6,14}[0-9]$/.test(phone) || PHONE_LOCAL.test(phone) || PHONE_INTL.test(phone)

type Contact = { name?: string; email?: string; phone?: string }

function savedContact(): Contact {
  try {
    return (JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null') as Contact) || {}
  } catch {
    return {}
  }
}

export function VideoPanel({ section, town }: { section: string; town: string | number | undefined }) {
  const [hasSaved, setHasSaved] = useState(false)
  const [description, setDescription] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [state, setState] = useState<'success' | 'error' | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const contact = savedContact()
    setName(contact.name || '')
    setEmail(contact.email || '')
    setPhone(contact.phone || '')
    setHasSaved(Boolean(contact.name && contact.email && contact.phone))
  }, [])

  const townId = Number.parseInt(String(town ?? ''), 10)
  const valid = description.length >= 20 && name.length > 0 && EMAIL.test(email) && phone.length > 0 && validPhone(phone) && Number.isFinite(townId)

  async function submit() {
    if (submitting || !valid) return
    setSubmitting(true)
    setState(null)
    const result = await sendVideoViolation({ section, town: townId, description, name, email, phone }, { recaptcha: recaptchaToken }).catch(
      () => ({ ok: false as const, message: '' }),
    )
    if (result.ok) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ name, email, phone }))
      } catch {
        // Storage blocked: the signal is sent anyway.
      }
      if (result.secret) {
        rememberReport({
          id: result.id,
          secret: result.secret,
          kind: 'violation',
          source: 'api',
          createdAt: new Date().toISOString(),
          title: `Видео сигнал, секция ${section}`,
          photoCount: 0,
        })
      }
      setHasSaved(true)
      setState('success')
      setDescription('')
    } else {
      setState('error')
    }
    setSubmitting(false)
  }

  return (
    <div className="rs-video-panel">
      <h2>Видеонаблюдение</h2>
      <a className="video-link" href={evideoUrl(section)} target="_blank" rel="noopener noreferrer">
        &#9654; Видеоизлъчване от секцията
      </a>
      <div className="signal-form">
        <textarea
          aria-label="Описание"
          placeholder="Опишете нарушението от видеонаблюдението..."
          value={description}
          onChange={(event) => {
            setDescription(event.target.value)
            if (state) setState(null)
          }}
        />
        {!hasSaved ? (
          <div className="contact-fields">
            <input type="text" aria-label="Име" placeholder="Име" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} />
            <input type="email" aria-label="Имейл" placeholder="Имейл" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            <input type="tel" aria-label="Телефон" placeholder="Телефон" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} />
          </div>
        ) : null}
        <div className="form-row">
          <button type="button" className="rs-button" disabled={submitting || !valid} onClick={() => void submit()}>
            Подай видео сигнал
          </button>
        </div>
        {state === 'success' ? <p className="form-message success">Сигналът беше изпратен успешно!</p> : null}
        {state === 'error' ? <p className="form-message error">Грешка при изпращане. Опитайте с подробния формуляр.</p> : null}
      </div>
    </div>
  )
}
