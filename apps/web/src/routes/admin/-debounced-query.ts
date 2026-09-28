import { useEffect, useState } from 'react'

export function useDebouncedQuery(value: string, onCommit: (next: string) => void, delay = 300) {
  const [draft, setDraft] = useState(value)
  useEffect(() => {
    setDraft(value)
  }, [value])
  useEffect(() => {
    if (draft === value) return
    const timer = window.setTimeout(() => onCommit(draft), delay)
    return () => window.clearTimeout(timer)
  }, [draft, value, onCommit, delay])
  return [draft, setDraft] as const
}
