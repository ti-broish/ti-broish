import { Link, useRouter } from '@tanstack/react-router'
import { crumbHref, type Crumb } from '../../home/results'
import { ArrowLeft } from './Icons'

// results: components/Crumbs.js — „Назад“, then every level up to this unit as arrow-shaped links.
export function Crumbs({ crumbs, name, segment }: { crumbs: Crumb[]; name: string; segment: string }) {
  const router = useRouter()
  return (
    <nav className="rs-crumbs" aria-label="Навигация">
      <button type="button" className="rs-crumbs__back" onClick={() => router.history.back()}>
        <span className="rs-crumbs__middle rs-crumbs__middle--clear">
          <ArrowLeft /> Назад
        </span>
      </button>
      {crumbs.map((crumb, i) => (
        <Link key={`${crumb.segment}-${i}`} to={crumbHref(crumb.segment)} className="rs-crumbs__link">
          {i === 0 ? null : <span className="rs-crumbs__back-arrow" />}
          <span className="rs-crumbs__middle">{crumb.name}</span>
          <span className="rs-crumbs__arrow" />
        </Link>
      ))}
      <Link to={crumbHref(segment)} className="rs-crumbs__link" aria-current="page">
        <span className="rs-crumbs__back-arrow" />
        <span className="rs-crumbs__middle">{name}</span>
        <span className="rs-crumbs__arrow" />
      </Link>
    </nav>
  )
}
