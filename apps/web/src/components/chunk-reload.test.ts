import { describe, expect, it, vi } from 'vitest'
import { CHUNK_RELOAD_KEY, RELOAD_GUARD_MS, isChunkLoadError, reloadOnceForChunkError } from './chunk-reload'

function memory() {
  const map = new Map<string, string>()
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => void map.set(key, value), map }
}

describe('chunk reload after a deploy', () => {
  it('recognises chunk-load failures from Chrome, Firefox and Safari', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://tibroish.bg/assets/access-Luld7l_k.js'))).toBe(true)
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true)
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError(new Error('Unable to preload CSS for /assets/x.css'))).toBe(true)
    expect(isChunkLoadError({ name: 'ChunkLoadError', message: '' })).toBe(true)
    expect(isChunkLoadError(new Error('wrapped', { cause: new TypeError('Failed to fetch dynamically imported module') }))).toBe(true)
    expect(isChunkLoadError(new Error('Секцията не се записа'))).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
  })

  it('reloads once, then not again inside the guard window, and again after it', () => {
    const storage = memory()
    const reload = vi.fn()
    expect(reloadOnceForChunkError(storage, reload, 1_000)).toBe(true)
    expect(storage.map.get(CHUNK_RELOAD_KEY)).toBe('1000')
    expect(reloadOnceForChunkError(storage, reload, 1_000 + RELOAD_GUARD_MS - 1)).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(reloadOnceForChunkError(storage, reload, 1_000 + RELOAD_GUARD_MS + 1)).toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('never reloads when sessionStorage throws (no guard, no loop)', () => {
    const reload = vi.fn()
    const broken = { getItem: () => { throw new Error('denied') }, setItem: () => {} }
    expect(reloadOnceForChunkError(broken, reload, 5)).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })
})
