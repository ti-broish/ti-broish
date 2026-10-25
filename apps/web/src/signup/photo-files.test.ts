import { describe, expect, it } from 'vitest'
import { takeFiles } from './photo-files'

/** A file input whose `files` empties when the value is cleared, like a browser FileList. */
function fakeInput(names: string[]) {
  let files: string[] = [...names]
  return {
    get files() {
      return files
    },
    get value() {
      return files.length ? `C:\\fakepath\\${files[0]}` : ''
    },
    set value(next: string) {
      if (next === '') files = []
    },
  }
}

describe('takeFiles', () => {
  it('keeps every picked photo even though clearing the input empties its list', () => {
    const input = fakeInput(['a.jpg', 'b.jpg', 'c.jpg'])
    expect(takeFiles(input)).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
    expect(input.value).toBe('')
    expect(input.files).toHaveLength(0)
  })

  it('returns nothing when no file was picked', () => {
    expect(takeFiles({ files: null, value: '' })).toEqual([])
  })
})
