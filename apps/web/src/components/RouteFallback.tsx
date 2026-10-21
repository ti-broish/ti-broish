import { Link } from '@tanstack/react-router'
import { useEffect } from 'react'
import { reloadIfChunkError } from './chunk-reload'
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

export function RouteErrorPage({ error, reset }: { error: unknown; reset?: () => void }) {
  // A route chunk from an older build is gone after a deploy: reload once for the new build.
  useEffect(() => {
    reloadIfChunkError(error)
  }, [error])
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
