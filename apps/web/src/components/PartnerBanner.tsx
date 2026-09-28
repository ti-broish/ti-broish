import { partnerFor } from '../signup/rules'

export function PartnerBanner({ source }: { source: string | null }) {
  if (!source) return null
  const partner = partnerFor(source)
  if (!partner) {
    return (
      <p className="rounded-2xl border border-[#53c0a4] bg-[#e4f5f0] px-4 py-3 leading-7">
        Записването идва от {source}.
      </p>
    )
  }
  return (
    <aside className="grid gap-1 rounded-2xl border border-[#163a5f] bg-[#163a5f] px-4 py-4 text-white">
      <p className="text-sm font-bold tracking-wide">{partner.name}</p>
      <p className="text-lg font-bold leading-7">{partner.note}</p>
      <a className="font-bold text-[#53c0a4]" href={partner.href}>
        {partner.href.replace('https://', '')}
      </a>
    </aside>
  )
}
