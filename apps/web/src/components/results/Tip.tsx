import { useState, type ReactNode } from 'react'
import type { TooltipRow } from '../../home/results'

// The results site's white hover card (react-tooltip there): a title, a rule and a table of rows.
export function TipCard({ title, rows, color, empty }: { title?: string; rows: TooltipRow[]; color?: string; empty?: string }) {
  return (
    <div className="rs-tip-card">
      {title ? (
        <>
          <h2 style={color ? { color } : undefined}>{title}</h2>
          <hr />
        </>
      ) : null}
      {empty ? (
        <p>{empty}</p>
      ) : (
        <table>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td>{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/** Shows the card above the element on hover or focus. */
export function Tip({ children, card, className, style }: { children: ReactNode; card: ReactNode; className?: string; style?: React.CSSProperties }) {
  const [open, setOpen] = useState(false)
  return (
    <span
      className={`rs-tip${className ? ` ${className}` : ''}`}
      style={style}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open ? <span className="rs-tip__box" role="tooltip">{card}</span> : null}
    </span>
  )
}
