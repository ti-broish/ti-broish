import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'
import { PageIntro } from '../components/SiteChrome'
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
