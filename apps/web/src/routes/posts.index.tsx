import { Link, createFileRoute } from '@tanstack/react-router'
import { PageIntro } from '../components/SiteChrome'
import { loadPosts } from '../signup/cms-posts'

export const Route = createFileRoute('/posts/')({
  loader: () => loadPosts(),
  component: PostsPage,
})

function PostsPage() {
  const posts = Route.useLoaderData()
  return (
    <article className="max-w-3xl space-y-6">
      <PageIntro title="Актуално" />
      {posts.length === 0 ? (
        <p className="text-base leading-7">Още няма публикации.</p>
      ) : (
        <ul className="grid gap-8">
          {posts.map((post) => (
            <li key={post.slug} className="grid gap-2">
              <Link to="/posts/$slug" params={{ slug: post.slug }} className="text-[#444] no-underline">
                <h2 className="text-2xl font-black">{post.title}</h2>
              </Link>
              {post.publishedLabel ? <p className="text-sm text-[#666]">{post.publishedLabel}</p> : null}
              {post.excerpt ? <p className="text-base leading-7">{post.excerpt}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}
