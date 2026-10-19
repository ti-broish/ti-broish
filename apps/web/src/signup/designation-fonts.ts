export interface DesignationFontBytes {
  regular: Uint8Array
  bold: Uint8Array
  /** Carlito (metric-compatible with Calibri), used by the template for the representative's name and ЕГН. */
  sans: Uint8Array
  /**
   * Arimo (metric-compatible with Arial) for Cyrillic in those runs: Calibri has no Cyrillic in the
   * committee's reference PDF, so Google Docs falls back to Arial for „<<Имена>>“ and keeps Calibri for the rest.
   */
  sansCyrillic: Uint8Array
}

type FontProvider = () => Promise<DesignationFontBytes>

let provider: FontProvider | null = null

/**
 * The Worker has no file system and no usable import.meta.url, so it registers
 * fonts bundled inline (see designation-fonts-worker.ts). Node reads the TTFs.
 */
export function useDesignationFonts(next: FontProvider | null) {
  provider = next
}

export async function loadDesignationFonts(): Promise<DesignationFontBytes> {
  if (provider) return provider()
  return loadFontsFromFiles()
}

async function loadFontsFromFiles(): Promise<DesignationFontBytes> {
  const { readFile } = await import('node:fs/promises')
  const read = async (name: string) =>
    new Uint8Array(await readFile(new URL(/* @vite-ignore */ `./fonts/${name}`, import.meta.url)))
  return {
    regular: await read('Tinos-Regular.ttf'),
    bold: await read('Tinos-Bold.ttf'),
    sans: await read('Carlito-Regular.ttf'),
    sansCyrillic: await read('Arimo-Regular.ttf'),
  }
}

export function dataUrlBytes(dataUrl: string) {
  const comma = dataUrl.indexOf(',')
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
