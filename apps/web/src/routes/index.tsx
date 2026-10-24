import { createFileRoute, redirect } from '@tanstack/react-router'
import { HOME_REDIRECT_TARGET } from '../site/home-redirect'

// Election days: the home page is the violation form. The worker answers `/` with a 302 before this
// route runs (src/server.ts); this covers in-app navigation to `/` (the logo). The query string is kept,
// so ?origin=iaz and the prefill parameters reach /signal. To undo: restore the home page from git history
// (before this change) and drop homeRedirect from src/server.ts.
export const Route = createFileRoute('/')({
  beforeLoad: ({ location }) => {
    throw redirect({ href: `${HOME_REDIRECT_TARGET}${location.searchStr}`, statusCode: 302, replace: true })
  },
})
