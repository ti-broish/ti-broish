import { describe, expect, it } from 'vitest'
import { segmentItems, type FeedItem } from './violations'

function item(id: string, region: string | null, section: string | null): FeedItem {
  return { id, video: false, text: 'x', createdAt: '', town: 'гр. София', municipality: 'Столична', country: null, region, municipalityKey: region ? `${region}46` : null, section }
}

const in24 = item('a', '24', '244601001')
const sofiaNoSection = item('b', null, null)
const in23 = item('c', '23', '234602012')

describe('segmentItems', () => {
  it('drops Sofia signals without a section from a МИР feed', () => {
    expect(segmentItems([in24, sofiaNoSection], [], '24').map((entry) => entry.id)).toEqual(['a'])
  })

  it('filters what is loaded until the МИР feed arrives', () => {
    expect(segmentItems(null, [in24, sofiaNoSection, in23], '23').map((entry) => entry.id)).toEqual(['c'])
  })
})
