export type Inline =
  | { kind: 'text'; text: string; strong: boolean; em: boolean; code: boolean }
  | { kind: 'link'; text: string; href: string; strong: boolean; em: boolean }

export type PostBlock =
  | { kind: 'paragraph' | 'h2' | 'h3' | 'quote'; inlines: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'image'; src: string; alt: string }

export interface PostSummary {
  slug: string
  title: string
  excerpt: string
  publishedAt: string | null
  publishedLabel: string | null
}

export interface PostArticle extends PostSummary {
  image: { src: string; alt: string } | null
  blocks: PostBlock[]
}

interface RawSpan {
  _type?: string
  text?: string
  marks?: string[]
}

interface RawMark {
  _key?: string
  _type?: string
  href?: string
}

interface RawBlock {
  _type?: string
  style?: string
  listItem?: string
  children?: RawSpan[]
  markDefs?: RawMark[]
  src?: unknown
  url?: unknown
  alt?: unknown
  asset?: { url?: unknown; src?: unknown }
}

export function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const href = value.trim()
  if (href.startsWith('/') && !href.startsWith('//')) return href
  try {
    const url = new URL(href)
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.toString()
  } catch {
    return null
  }
  return null
}

export function publishedLabel(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('bg-BG', {
    timeZone: 'Europe/Sofia',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

export function imageFrom(raw: string | null): { src: string; alt: string } | null {
  if (!raw) return null
  const direct = safeUrl(raw)
  if (direct) return { src: direct, alt: '' }
  try {
    const value = JSON.parse(raw) as { src?: unknown; url?: unknown; alt?: unknown }
    const src = safeUrl(value.src) ?? safeUrl(value.url)
    if (!src) return null
    return { src, alt: typeof value.alt === 'string' ? value.alt : '' }
  } catch {
    return null
  }
}

function inlinesFrom(block: RawBlock): Inline[] {
  const defs = new Map((block.markDefs ?? []).map((mark) => [mark._key, mark]))
  const inlines: Inline[] = []
  for (const span of block.children ?? []) {
    if (span._type && span._type !== 'span') continue
    const text = span.text ?? ''
    if (!text) continue
    const marks = span.marks ?? []
    const strong = marks.includes('strong')
    const em = marks.includes('em')
    const code = marks.includes('code')
    const link = marks
      .map((mark) => defs.get(mark))
      .find((mark) => mark?._type === 'link')
    const href = safeUrl(link?.href)
    if (href) inlines.push({ kind: 'link', text, href, strong, em })
    else inlines.push({ kind: 'text', text, strong, em, code })
  }
  return inlines
}

function imageBlock(block: RawBlock): PostBlock | null {
  const src = safeUrl(block.src) ?? safeUrl(block.url) ?? safeUrl(block.asset?.src) ?? safeUrl(block.asset?.url)
  if (!src) return null
  return { kind: 'image', src, alt: typeof block.alt === 'string' ? block.alt : '' }
}

export function blocksFromPortable(value: unknown): PostBlock[] {
  if (!Array.isArray(value)) return []
  const blocks: PostBlock[] = []
  let list: { ordered: boolean; items: Inline[][] } | null = null
  const flush = () => {
    if (list && list.items.length > 0) blocks.push({ kind: 'list', ordered: list.ordered, items: list.items })
    list = null
  }
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const block = item as RawBlock
    if (block._type === 'image') {
      flush()
      const image = imageBlock(block)
      if (image) blocks.push(image)
      continue
    }
    if (block._type && block._type !== 'block') continue
    const inlines = inlinesFrom(block)
    if (inlines.length === 0) continue
    if (block.listItem === 'bullet' || block.listItem === 'number') {
      const ordered = block.listItem === 'number'
      if (!list || list.ordered !== ordered) {
        flush()
        list = { ordered, items: [] }
      }
      list.items.push(inlines)
      continue
    }
    flush()
    const kind =
      block.style === 'h1' || block.style === 'h2'
        ? 'h2'
        : block.style === 'h3' || block.style === 'h4'
          ? 'h3'
          : block.style === 'blockquote'
            ? 'quote'
            : 'paragraph'
    blocks.push({ kind, inlines })
  }
  flush()
  return blocks
}

export function summaryFromRow(row: { slug: string; title: string | null; excerpt: string | null; published_at: string | null }): PostSummary {
  return {
    slug: row.slug,
    title: row.title?.trim() || 'Без заглавие',
    excerpt: row.excerpt?.trim() ?? '',
    publishedAt: row.published_at,
    publishedLabel: publishedLabel(row.published_at),
  }
}

export function articleFromRow(row: {
  slug: string
  title: string | null
  excerpt: string | null
  published_at: string | null
  featured_image: string | null
  content: string | null
}): PostArticle {
  let content: unknown = []
  if (row.content) {
    try {
      content = JSON.parse(row.content) as unknown
    } catch {
      content = []
    }
  }
  return {
    ...summaryFromRow(row),
    image: imageFrom(row.featured_image),
    blocks: blocksFromPortable(content),
  }
}
