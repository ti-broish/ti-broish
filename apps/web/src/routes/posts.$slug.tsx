import { createFileRoute, notFound } from '@tanstack/react-router'
import { PostBody } from '../components/PostBody'
import { PageIntro } from '../components/SiteChrome'
import { loadPost } from '../signup/cms-posts'

export const Route = createFileRoute('/posts/$slug')({
  loader: async ({ params }) => {
    const post = await loadPost({ data: params.slug })
    if (!post) throw notFound()
    return post
  },
  component: PostPage,
})

function PostPage() {
  const post = Route.useLoaderData()
  return (
    <article className="max-w-3xl space-y-4">
      <PageIntro title={post.title} lede={post.publishedLabel ?? undefined} />
      {post.image ? <img src={post.image.src} alt={post.image.alt} className="w-full rounded-2xl" /> : null}
      {post.excerpt ? <p className="text-lg leading-7 text-[#333]">{post.excerpt}</p> : null}
      <PostBody blocks={post.blocks} />
    </article>
  )
}
