import boldDataUrl from './fonts/Tinos-Bold.ttf?inline'
import regularDataUrl from './fonts/Tinos-Regular.ttf?inline'
import { dataUrlBytes, useDesignationFonts, type DesignationFontBytes } from './designation-fonts'

let cached: DesignationFontBytes | null = null

/** Registers the Tinos faces bundled into the Worker as data URLs. */
export function registerWorkerDesignationFonts() {
  useDesignationFonts(async () => {
    cached ??= { regular: dataUrlBytes(regularDataUrl), bold: dataUrlBytes(boldDataUrl) }
    return cached
  })
}
