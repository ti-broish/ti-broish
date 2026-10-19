import boldDataUrl from './fonts/Tinos-Bold.ttf?inline'
import regularDataUrl from './fonts/Tinos-Regular.ttf?inline'
import sansDataUrl from './fonts/Carlito-Regular.ttf?inline'
import { dataUrlBytes, useDesignationFonts, type DesignationFontBytes } from './designation-fonts'

let cached: DesignationFontBytes | null = null

/** Registers the Tinos and Carlito faces bundled into the Worker as data URLs. */
export function registerWorkerDesignationFonts() {
  useDesignationFonts(async () => {
    cached ??= { regular: dataUrlBytes(regularDataUrl), bold: dataUrlBytes(boldDataUrl), sans: dataUrlBytes(sansDataUrl) }
    return cached
  })
}
