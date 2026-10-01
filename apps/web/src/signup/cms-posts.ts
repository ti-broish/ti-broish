import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { articleFromRow, summaryFromRow, type PostArticle, type PostSummary } from './post-body'

interface Statement {
  first<T>(): Promise<T | null>
  all<T>(): Promise<{ results?: T[] }>
  bind(...values: unknown[]): Statement
}

interface CmsD1 {
  prepare(sql: string): Statement
}

const LIST = `
SELECT slug, title, excerpt, published_at
FROM ec_posts
WHERE status = 'published' AND deleted_at IS NULL
ORDER BY published_at DESC, slug ASC
LIMIT 50`

const ONE = `
SELECT slug, title, excerpt, published_at, featured_image, content
FROM ec_posts
WHERE status = 'published' AND deleted_at IS NULL AND slug = ?
LIMIT 1`

function cmsDatabase() {
  return (env as unknown as { CMS?: CmsD1 }).CMS ?? null
}

function missingTable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /no such table/i.test(message)
}

export const loadPosts = createServerFn({ method: 'GET' }).handler(async (): Promise<PostSummary[]> => {
  const db = cmsDatabase()
  if (!db) return []
  try {
    const rows = await db.prepare(LIST).all<{ slug: string; title: string | null; excerpt: string | null; published_at: string | null }>()
    return (rows.results ?? []).filter((row) => row.slug).map(summaryFromRow)
  } catch (error) {
    if (missingTable(error)) return []
    throw error
  }
})

export const loadPost = createServerFn({ method: 'GET' })
  .validator((slug: string) => slug)
  .handler(async ({ data: slug }): Promise<PostArticle | null> => {
    if (!slug || slug.length > 200 || slug.includes('/') || slug.includes('\\') || slug.includes('..')) return null
    const db = cmsDatabase()
    if (!db) return null
    try {
      const row = await db
        .prepare(ONE)
        .bind(slug)
        .first<{
          slug: string
          title: string | null
          excerpt: string | null
          published_at: string | null
          featured_image: string | null
          content: string | null
        }>()
      return row?.slug ? articleFromRow(row) : null
    } catch (error) {
      if (missingTable(error)) return null
      throw error
    }
  })
