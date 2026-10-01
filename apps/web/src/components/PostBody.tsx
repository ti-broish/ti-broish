import type { Inline, PostBlock } from '../signup/post-body'

function Inlines({ inlines }: { inlines: Inline[] }) {
  return (
    <>
      {inlines.map((inline, index) => {
        const className = [inline.strong ? 'font-bold' : '', inline.em ? 'italic' : ''].filter(Boolean).join(' ')
        if (inline.kind === 'link') {
          const external = inline.href.startsWith('http')
          return (
            <a
              key={index}
              href={inline.href}
              className={`text-[#2b062f] underline ${className}`}
              target={external ? '_blank' : undefined}
              rel={external ? 'noopener noreferrer' : undefined}
            >
              {inline.text}
            </a>
          )
        }
        if (inline.code) return <code key={index} className={className}>{inline.text}</code>
        if (className) return <span key={index} className={className}>{inline.text}</span>
        return <span key={index}>{inline.text}</span>
      })}
    </>
  )
}

export function PostBody({ blocks }: { blocks: PostBlock[] }) {
  return (
    <div className="space-y-4 text-base leading-7">
      {blocks.map((block, index) => {
        if (block.kind === 'image') {
          return <img key={index} src={block.src} alt={block.alt} className="w-full rounded-2xl" />
        }
        if (block.kind === 'list') {
          const List = block.ordered ? 'ol' : 'ul'
          return (
            <List key={index} className={block.ordered ? 'list-decimal space-y-2 pl-5' : 'list-disc space-y-2 pl-5'}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <Inlines inlines={item} />
                </li>
              ))}
            </List>
          )
        }
        if (block.kind === 'h2') {
          return (
            <h2 key={index} className="text-2xl font-black text-[#444]">
              <Inlines inlines={block.inlines} />
            </h2>
          )
        }
        if (block.kind === 'h3') {
          return (
            <h3 key={index} className="text-xl font-bold text-[#444]">
              <Inlines inlines={block.inlines} />
            </h3>
          )
        }
        if (block.kind === 'quote') {
          return (
            <blockquote key={index} className="border-l-4 border-[#53c0a4] pl-4">
              <Inlines inlines={block.inlines} />
            </blockquote>
          )
        }
        return (
          <p key={index}>
            <Inlines inlines={block.inlines} />
          </p>
        )
      })}
    </div>
  )
}
