import { Link } from '@tanstack/react-router'
import { isProtocolDay } from '../signup/election'

export function ElectionActions() {
  return (
    <div className="grid gap-3">
      <Link to="/signal" className="brand-button">
        Подай сигнал
      </Link>
      {isProtocolDay() ? (
        <Link to="/protokol" className="brand-button">
          Изпрати протокол
        </Link>
      ) : null}
      <Link to="/izprateni" className="brand-button">
        Изпратените от теб
      </Link>
    </div>
  )
}
