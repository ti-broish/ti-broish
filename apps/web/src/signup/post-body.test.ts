import { describe, expect, it } from 'vitest'
import { articleFromRow, blocksFromPortable, imageFrom, publishedLabel, safeUrl } from './post-body'

const guardian = [
  {
    _type: 'block',
    _key: 'b0',
    style: 'normal',
    children: [
      {
        _type: 'span',
        text: 'На тези избори записването е за представител на Инициативния комитет за кандидат-президентската двойка Андрей Гюров и Георги Кандев.',
      },
    ],
  },
  {
    _type: 'block',
    style: 'normal',
    listItem: 'bullet',
    children: [{ _type: 'span', text: 'да присъстваш при броенето' }],
  },
  {
    _type: 'block',
    style: 'normal',
    listItem: 'bullet',
    children: [
      {
        _type: 'span',
        text: 'протокол',
        marks: ['strong', 'link1'],
      },
    ],
    markDefs: [{ _key: 'link1', _type: 'link', href: 'https://tibroish.bg/instructions' }],
  },
]

describe('EmDash post body', () => {
  it('keeps the published guardian paragraphs and groups the list', () => {
    const blocks = blocksFromPortable(guardian)
    expect(blocks[0]).toMatchObject({
      kind: 'paragraph',
      inlines: [{ kind: 'text', text: expect.stringContaining('Андрей Гюров') }],
    })
    expect(blocks[1]).toMatchObject({
      kind: 'list',
      ordered: false,
      items: [
        [{ kind: 'text', text: 'да присъстваш при броенето' }],
        [{ kind: 'link', href: 'https://tibroish.bg/instructions', strong: true, text: 'протокол' }],
      ],
    })
  })

  it('drops javascript urls and reads an image object', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull()
    expect(safeUrl('/_emdash/api/media/file/photo.jpg')).toBe('/_emdash/api/media/file/photo.jpg')
    expect(imageFrom(JSON.stringify({ src: '/_emdash/api/media/file/photo.jpg', alt: 'Секция' }))).toEqual({
      src: '/_emdash/api/media/file/photo.jpg',
      alt: 'Секция',
    })
  })

  it('formats the published date in Sofia', () => {
    expect(publishedLabel('2026-09-27T17:02:39.869Z')).toBe('27 септември 2026 г.')
  })

  it('builds an article from a CMS row', () => {
    const article = articleFromRow({
      slug: 'kakvo-pravi-pazitelyat',
      title: 'Какво прави пазителят на вота',
      excerpt: 'Правата на представителя в изборния ден.',
      published_at: '2026-09-27T17:02:39.869Z',
      featured_image: null,
      content: JSON.stringify(guardian),
    })
    expect(article.slug).toBe('kakvo-pravi-pazitelyat')
    expect(article.publishedLabel).toBe('27 септември 2026 г.')
    expect(article.blocks).toHaveLength(2)
  })
})
