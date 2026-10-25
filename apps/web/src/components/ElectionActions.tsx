import { Link } from '@tanstack/react-router'
import { WhenProtocolOpen } from './WhenProtocolOpen'

export function ElectionActions() {
  return (
    <div className="grid gap-3">
      <Link to="/signal" className="brand-button">
        Подай сигнал
      </Link>
      <WhenProtocolOpen>
        <Link to="/protokol" className="brand-button">
          Изпрати протокол
        </Link>
      </WhenProtocolOpen>
      <Link to="/izprateni" className="brand-button">
        Изпратените от теб
      </Link>
    </div>
  )
}
