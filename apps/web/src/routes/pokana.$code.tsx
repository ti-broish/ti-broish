import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'
import { PageIntro } from '../components/SiteChrome'
import { signupsClosed, SIGNUPS_CLOSED_MESSAGE } from '../signup/signups-closed'
import { updateProfile, useProfile } from '../signup/store'

export const Route = createFileRoute('/pokana/$code')({ component: InvitePage })

function InvitePage() {
  const { code } = Route.useParams()
  const { profile } = useProfile()

  useEffect(() => {
    updateProfile((current) => ({
      ...current,
      joinedInvite: code,
      referredBy: current.referredBy || code,
    }))
  }, [code])

  const own = profile.inviteCode === code

  if (signupsClosed()) {
    return (
      <div className="grid max-w-xl gap-4">
        <PageIntro title="Записването приключи" lede={SIGNUPS_CLOSED_MESSAGE} />
        <Link to="/vhod" className="brand-button">
          Вход
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-xl">
      <PageIntro
        title={own ? 'Това е твоята покана' : 'Поканиха те да се запишеш'}
        lede="Това е лична покана. Записването е твое и не те слага в група с човека, който ти я праща."
      />
      <p className="mb-4 font-bold tracking-widest">{code}</p>
      <a href={`/signup?ref=${encodeURIComponent(code)}`} className="brand-button">
        {own ? 'Към записването' : 'Запиши се'}
      </a>
    </div>
  )
}
