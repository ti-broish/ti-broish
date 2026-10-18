import { useEffect, useState } from 'react'
import { adminBrevoHealth } from '../../signup/admin-brevo'
import type { BrevoHealthReport } from '../../signup/brevo'

export function BrevoHealthSummary() {
  const [lines, setLines] = useState<string[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    void adminBrevoHealth().then((result) => {
      if (!result.ok) {
        setError(result.message)
        return
      }
      if (!result.configured) {
        setLines([result.message])
        return
      }
      setLines(formatHealth(result.health))
    })
  }, [])

  if (error) return <p className="text-sm text-[#a33]">{error}</p>
  if (lines.length === 0) return <p className="text-sm text-[#333]">Проверявам Brevo…</p>
  return (
    <ul className="grid gap-1 text-sm text-[#333]">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  )
}

function formatHealth(health: BrevoHealthReport): string[] {
  const lines: string[] = []
  if (health.account.ok) {
    lines.push(
      `Акаунт: ${health.account.companyName ?? '—'} · ${health.account.email ?? '—'}${
        health.account.plan ? ` · план ${health.account.plan}` : ''
      }${typeof health.account.credits === 'number' ? ` · кредити ${health.account.credits}` : ''}`,
    )
  } else {
    lines.push(`Акаунт: ${health.account.error ?? 'грешка'}`)
  }

  if (health.list.ok) {
    lines.push(
      `Списък ${health.list.id}: ${health.list.name ?? '—'}${
        typeof health.list.totalSubscribers === 'number' ? ` · ${health.list.totalSubscribers} абонати` : ''
      }`,
    )
  } else {
    lines.push(`Списък: ${health.list.error ?? 'грешка'}`)
  }

  if (health.attributes.ok) {
    lines.push('Атрибути: всички задължителни са налице.')
  } else if (health.attributes.error) {
    lines.push(`Атрибути: ${health.attributes.error}`)
  } else {
    const bits: string[] = []
    if (health.attributes.missing.length) bits.push(`липсват ${health.attributes.missing.join(', ')}`)
    if (health.attributes.wrongType.length) {
      bits.push(
        `грешен тип: ${health.attributes.wrongType
          .map((item) => `${item.name} (${item.actual || '—'} ≠ ${item.expected.join('/')})`)
          .join('; ')}`,
      )
    }
    if (health.attributes.roleLabelGaps.length) {
      bits.push(`ROLE без етикети ${health.attributes.roleLabelGaps.join(', ')}`)
    }
    lines.push(`Атрибути: ${bits.join(' · ') || 'проблем'}`)
  }

  if (health.sender.error) lines.push(`Подател: ${health.sender.error}`)
  else lines.push(health.sender.message)

  return lines
}
