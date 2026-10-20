import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { IAZ_LABEL } from '../../signup/partner-import'
import { adminProfileIdFor } from '../../signup/partner-people-sql'

const IAZ_BADGE = 'ml-2 rounded-full border border-[#2b062f] bg-[#f4e4b3] px-2 py-0.5 text-xs font-bold text-[#1a1020]'

/**
 * A person's name linked to their admin profile, styled like Записани and Секции.
 * „И аз“ partner people have no profile: plain text with the „И аз“ badge.
 */
export function PersonName({ id, name, badge = true }: { id: string; name: ReactNode; badge?: boolean }) {
  const profileId = adminProfileIdFor(id)
  if (profileId) {
    return (
      <Link to="/admin/signups/$personId" params={{ personId: profileId }} className="font-bold text-[#2b062f] underline">
        {name}
      </Link>
    )
  }
  return (
    <>
      {name}
      {badge ? <span className={IAZ_BADGE}>{IAZ_LABEL}</span> : null}
    </>
  )
}
