import { useEffect, useRef, useState } from 'react'
import { adminGhost } from './admin-ui'
import type { AuditLine } from '../signup/admin-audit'
import { egnRevealPath, maskEgn } from '../signup/egn-reveal'

/** The revealed number hides itself after this long, so it does not stay on an unattended screen. */
const AUTO_HIDE_MS = 2 * 60 * 1000

type State = { kind: 'hidden' } | { kind: 'loading' } | { kind: 'shown'; egn: string } | { kind: 'error'; message: string }

/**
 * ЕГН masked by default (••••••1234). „Покажи ЕГН“ is for admins: it asks the server for the full
 * number, which writes who and when to the person's history. „Скрий“ drops it from the page again.
 */
export function EgnReveal({
  personId,
  hasEgn,
  last4,
  canReveal,
  compact = false,
  onRevealed,
}: {
  personId: string
  hasEgn: boolean
  last4: string
  canReveal: boolean
  compact?: boolean
  onRevealed?: (audit: AuditLine | null) => void
}) {
  const [state, setState] = useState<State>({ kind: 'hidden' })
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setState({ kind: 'hidden' })
    setCopied(false)
  }, [personId])

  useEffect(() => {
    if (state.kind !== 'shown') return
    timer.current = setTimeout(() => setState({ kind: 'hidden' }), AUTO_HIDE_MS)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [state])

  const masked = hasEgn ? maskEgn(last4) || 'ЕГН е въведено' : 'Няма ЕГН'
  const button = compact ? 'text-xs font-bold text-[#2b062f] underline disabled:opacity-40' : adminGhost

  const reveal = () => {
    setState({ kind: 'loading' })
    setCopied(false)
    void fetch(egnRevealPath(personId), {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { ok?: boolean; egn?: string; message?: string; audit?: AuditLine } | null
        if (!response.ok || !body?.ok || !body.egn) {
          setState({ kind: 'error', message: body?.message || 'ЕГН не се показа.' })
          return
        }
        setState({ kind: 'shown', egn: body.egn })
        onRevealed?.(body.audit ?? null)
      })
      .catch(() => setState({ kind: 'error', message: 'ЕГН не се показа.' }))
  }

  return (
    <div className={compact ? 'flex flex-wrap items-center gap-2 text-xs' : 'grid gap-2'} data-testid="egn-reveal">
      <div className="flex flex-wrap items-center gap-2">
        {state.kind === 'shown' ? (
          <span className="font-mono text-base font-bold tracking-wider" data-testid="egn-value" aria-live="polite">
            {state.egn}
          </span>
        ) : (
          <span className={hasEgn && last4 ? 'font-mono tracking-wider' : ''} data-testid="egn-masked">
            {masked}
          </span>
        )}
        {canReveal && hasEgn && state.kind !== 'shown' ? (
          <button type="button" className={button} disabled={state.kind === 'loading'} onClick={reveal}>
            {state.kind === 'loading' ? 'Показваме…' : 'Покажи ЕГН'}
          </button>
        ) : null}
        {state.kind === 'shown' ? (
          <>
            <button
              type="button"
              className={button}
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(state.egn)
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false))
              }}
            >
              {copied ? 'Копирано' : 'Копирай'}
            </button>
            <button
              type="button"
              className={button}
              onClick={() => {
                setState({ kind: 'hidden' })
                setCopied(false)
              }}
            >
              Скрий
            </button>
          </>
        ) : null}
      </div>
      {state.kind === 'shown' && !compact ? <p className="text-xs text-[#333]">Прегледът е записан в историята.</p> : null}
      {state.kind === 'error' ? (
        <p className="text-xs font-bold text-[#8f1d1d]" role="alert">
          {state.message}
        </p>
      ) : null}
    </div>
  )
}
