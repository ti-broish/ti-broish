import { formatR, priorityLevelLabel, type PriorityInfo } from '../../signup/priority-sections'

export function PriorityBadge({ info }: { info: PriorityInfo | null | undefined }) {
  if (!info) return null
  const level = info.level.trim().toLowerCase()
  const tone =
    level === 'quarantine'
      ? 'bg-[#8f1d1d] text-white'
      : level === 'elevated'
        ? 'bg-[#e8a23a] text-[#1a1020]'
        : 'border border-[#2b062f] bg-[#fff4cc] text-[#1a1020]'
  return (
    <span
      className={`inline-flex min-h-6 items-center gap-1 whitespace-nowrap rounded-full px-2 text-xs font-black ${tone}`}
      title={`Приоритетна секция: ${priorityLevelLabel(info.level)}, R ${formatR(info.r)}`}
      data-testid="priority-badge"
    >
      ★ {priorityLevelLabel(info.level)} · R {formatR(info.r)}
    </span>
  )
}
