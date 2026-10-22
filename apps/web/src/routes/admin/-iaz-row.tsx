// „И аз“ rows on Записвания: their own colour and badge, so they never pass for our signups.
export const IAZ_ROW_TINT = 'bg-[#e3f1f4]'
export const IAZ_ROW_BORDER = 'border-l-4 border-l-[#0f5f73]'

export function IazBadge() {
  return (
    <span className="inline-flex min-h-7 items-center rounded-full bg-[#0f5f73] px-2 text-xs font-black text-white" data-testid="iaz-badge">
      „И аз“
    </span>
  )
}
