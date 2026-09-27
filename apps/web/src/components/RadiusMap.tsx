import { OBLASTS, MAP_HEIGHT, MAP_WIDTH } from '../signup/oblasts'

export function RadiusMap({
  regionCodes,
  interactive,
  onToggle,
}: {
  regionCodes: string[]
  interactive?: boolean
  onToggle?: (regionCode: string) => void
}) {
  const selected = new Set(regionCodes)
  return (
    <figure className="overflow-hidden border border-[#ddd] bg-[#eee]">
      <svg viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} className="h-auto w-full" role="img" aria-label="Карта на областите в България">
        <rect width={MAP_WIDTH} height={MAP_HEIGHT} fill="#eee" />
        {OBLASTS.map((oblast) => {
          const on = oblast.regionCodes.some((code) => selected.has(code))
          const toggleCode = oblast.regionCodes[0]
          return (
            <path
              key={oblast.id}
              d={oblast.d}
              fill={on ? '#53c0a4' : '#fff'}
              stroke="#2b062f"
              strokeWidth={on ? 2.2 : 1}
              className={interactive ? 'cursor-pointer' : undefined}
              onClick={interactive && toggleCode ? () => onToggle?.(toggleCode) : undefined}
            >
              <title>{oblast.name}</title>
            </path>
          )
        })}
      </svg>
      <figcaption className="px-3 py-2 text-xs leading-5 text-[var(--ink-soft)]">
        Граници на областите по Boyan Yurukov, Bulgaria-geocoding. Район, град и община се пазят в списъка. На картата свети областта, която ги съдържа. При „други области“ натисни област, за да я добавиш.
      </figcaption>
    </figure>
  )
}
