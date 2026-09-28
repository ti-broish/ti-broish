import { Link } from '@tanstack/react-router'
import { PageIntro } from './SiteChrome'

export function NotFoundPage() {
  return (
    <div className="grid gap-4">
      <PageIntro title="Няма такава страница" lede="Адресът не води към страница от Ти Броиш." />
      <Link to="/" className="brand-button">
        Към началото
      </Link>
    </div>
  )
}

export function RouteErrorPage({ reset }: { error: unknown; reset?: () => void }) {
  return (
    <div className="grid gap-4">
      <PageIntro title="Нещо се обърка" lede="Опитай отново. Ако пак спре, започни от началото." />
      {reset ? (
        <button type="button" className="brand-button" onClick={() => reset()}>
          Опитай отново
        </button>
      ) : null}
      <Link to="/" className="font-bold">
        Към началото
      </Link>
    </div>
  )
}
