import type { ReactNode } from 'react'
import { useProtocolOpen } from '../signup/protocol-window'

/** Renders „Изпрати протокол“ links and buttons only while protocols can be sent (signup/protocol-window.ts). */
export function WhenProtocolOpen({ children }: { children: ReactNode }) {
  return useProtocolOpen() ? <>{children}</> : null
}
