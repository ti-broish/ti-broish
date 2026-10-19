import boldDataUrl from './fonts/Tinos-Bold.ttf?inline'
import regularDataUrl from './fonts/Tinos-Regular.ttf?inline'
import sansDataUrl from './fonts/Carlito-Regular.ttf?inline'
import sansCyrillicDataUrl from './fonts/Arimo-Regular.ttf?inline'
import { dataUrlBytes, useDesignationFonts, type DesignationFontBytes } from './designation-fonts'

let cached: DesignationFontBytes | null = null

/** Registers the Tinos, Carlito and Arimo faces bundled into the Worker as data URLs. */
export function registerWorkerDesignationFonts() {
  useDesignationFonts(async () => {
    cached ??= {
      regular: dataUrlBytes(regularDataUrl),
      bold: dataUrlBytes(boldDataUrl),
      sans: dataUrlBytes(sansDataUrl),
      sansCyrillic: dataUrlBytes(sansCyrillicDataUrl),
    }
    return cached
  })
}
