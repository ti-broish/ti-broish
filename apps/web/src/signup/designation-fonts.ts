const REGULAR_URL = new URL('./fonts/Tinos-Regular.ttf', import.meta.url)
const BOLD_URL = new URL('./fonts/Tinos-Bold.ttf', import.meta.url)

export async function loadDesignationFonts() {
  return {
    regular: await readFontBytes(REGULAR_URL),
    bold: await readFontBytes(BOLD_URL),
  }
}

async function readFontBytes(url: URL) {
  if (url.protocol === 'file:') {
    const { readFile } = await import('node:fs/promises')
    return new Uint8Array(await readFile(url))
  }
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Не се зареди шрифтът (${response.status}).`)
  return new Uint8Array(await response.arrayBuffer())
}
