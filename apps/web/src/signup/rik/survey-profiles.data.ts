/**
 * What each РИК's представители register looked like when we surveyed it (21.10.2026), so the
 * admin can say why a РИК needs a look and the tests cover every shape. Generated from the
 * ns202604 (19.04.2026) and pvrns2021 (14.11.2021) registers of our coalition on all 31 РИК sites;
 * counts and shapes only, no names. „N“ is any number, dd.mm.yyyy a date.
 * - layout2604 „growing-table“: one batch page per party that keeps growing; „batches“: a new
 *   batch page per decision, sometimes emptied later after a merge (emptiedBatches2604).
 * - All 31 use the same CIK platform: /<election>/registers/register_p → batch pages ?id=N, two
 *   columns (name, „№ и дата на пълномощното“), no ЕГН. None was paginated.
 */
export interface RikSurveyProfile {
  mir: string
  name: string
  layout2604: 'growing-table' | 'batches'
  batches2604: number
  emptiedBatches2604: number
  numberShapes2604: string[]
  numberShapes2021: string[]
  nameStyles: string[]
}

export const RIK_SURVEY_PROFILES: RikSurveyProfile[] = [
  {"mir": "01", "name": "Благоевград", "layout2604": "growing-table", "batches2604": 1, "emptiedBatches2604": 0, "numberShapes2604": ["N/dd.mm.yyyy", "N/dd.mm.yyyy г.", "№N/dd.mm.yyyyг."], "numberShapes2021": ["N/dd.mm.yy", "N/dd.mm.yyyyг.", "№ N/dd.mm.yyyyг.", "№N/dd.mm.yyyyг."], "nameStyles": ["4+ words", "caps", "hyphenated"]},
  {"mir": "02", "name": "Бургас", "layout2604": "batches", "batches2604": 7, "emptiedBatches2604": 1, "numberShapes2604": ["N", "N/dd.mm.yyyy", "N/dd.mm.yyyy г."], "numberShapes2021": ["N/dd.mm.yyyyг."], "nameStyles": ["4+ words", "annulled rows", "caps", "hyphenated"]},
  {"mir": "03", "name": "Варна", "layout2604": "growing-table", "batches2604": 1, "emptiedBatches2604": 0, "numberShapes2604": ["N/dd.mm.yyyy", "№N - dd.mm.yyyy г.", "N/dd.mm.yyyy г.", "N"], "numberShapes2021": ["N / dd.mm.yyyy г."], "nameStyles": ["annulled rows", "hyphenated"]},
  {"mir": "04", "name": "Велико Търново", "layout2604": "growing-table", "batches2604": 1, "emptiedBatches2604": 0, "numberShapes2604": ["N/dd.mm.yyyy", "N/dd.mm.yyyy г.", "N"], "numberShapes2021": ["N/dd.mm.yyyy"], "nameStyles": ["4+ words", "annulled rows", "hyphenated"]},
  {"mir": "05", "name": "Видин", "layout2604": "growing-table", "batches2604": 1, "emptiedBatches2604": 0, "numberShapes2604": ["№ N / dd.mm.yyyy", "№ N/ dd.mm.yyyy", "N/dd.mm.yyyy"], "numberShapes2021": [], "nameStyles": ["4+ words", "hyphenated"]},
  {"mir": "06", "name": "Враца", "layout2604": "growing-table", "batches2604": 1, "emptiedBatches2604": 0, "numberShapes2604": ["N/dd.mm.yyyy", "N/dd.mm.yyyy г.", "N/dd.mm.yyyyг."], "numberShapes2021": ["N/dd.mm.yyyy"], "nameStyles": ["4+ words", "hyphenated"]},
  {"mir": "07", "name": "Габрово", "layout2604": "batches", "batches2604": 5, "emptiedBatches2604": 0, "numberShapes2604": ["N/dd.mm.yyyy", "N/dd.mm.yyyy г."], "numberShapes2021": ["N/dd.mm.yyyy г."], "nameStyles": ["hyphenated"]},
  {"mir": "08", "name": "Добрич", "layout2604": "growing-table", "batches2604": 1, "emptiedBatches2604": 0, "numberShapes2604": ["N/dd.mm.yyyy", "N", "N/dd.mm.yyyy г."], "numberShapes2021": [], "nameStyles": ["annulled rows"]},
  {"mir": "09", "name": "Кърджали", "layout2604": "growing-table", "batches2604": 1, "emptiedBatches2604": 0, "numberShapes2604": ["N/dd.mm.yyyy"], "numberShapes2021": ["N/dd.mm.yyyy"], "nameStyles": []},
  {"mir": "10", "name": "Кюстендил", "layout2604": "growing-table", "batches2604": 1, "emptiedBatches2604": 0, "numberShapes2604": ["N/dd.mm.yyyy", "N/dd.mm.yyyy г."], "numberShapes2021": [], "nameStyles": ["hyphenated"]},
  {"mir": "11", "name": "Ловеч", "layout2604": "growing-table", "batches2604": 1, "emptiedBatches2604": 0, "numberShapes2604": ["N/dd.mm.yyyy", "N/dd.mm.yyyy г."], "numberShapes2021": [], "nameStyles": ["annulled rows", "hyphenated"]},
  {"mir": "12", "name": "Монтана", "layout2604": "growing-table", "batches2604": 1, "emptiedBatches2604": 0, "numberShapes2604": ["N/dd.mm.yyyy г.", "N/dd.mm.yyyy", "№ N/ dd.mm.yyyyг."], "numberShapes2021": ["№N/dd.mm.yyyy"], "nameStyles": ["annulled rows", "caps", "hyphenated"]},
  {"mir": "13", "name": "Пазарджик", "layout2604": "growing-table", "batches2604": 1, "emptiedBatches2604": 0, "numberShapes2604": ["N/dd.mm.yyyy г.", "N/dd.mm.yyyy", "N/dd.mm.yyyy г,"], "numberShapes2021": [], "nameStyles": ["annulled rows"]},
  {"mir": "14", "name": "Перник", "layout2604": "growing-table", "batches2604": 1, "emptiedBatches2604": 0, "numberShapes2604": ["N", "N/dd.mm.yyyy"], "numberShapes2021": [], "nameStyles": ["annulled rows", "caps"]},
  {"mir": "15", "name": "Плевен", "layout2604": "growing-table", "batches2604": 1, "emptiedBatches2604": 0, "numberShapes2604": ["N/dd.mm.yyyy", "N/dd.mm.yyyy г.", "N"], "numberShapes2021": ["N/ dd.mm.yyyyг.", "N / dd.mm.yyyyг.", "N/dd.mm.yyyyг.", "N/ dd.mm.yyyyг"], "nameStyles": ["annulled rows", "caps", "hyphenated"]},
  {"mir": "16", "name": "Пловдив град", "layout2604": "growing-table", "batches2604": 1, "emptiedBatches2604": 0, "numberShapes2604": ["N/dd.mm.yyyy", "N/dd.mm.yyyy г."], "numberShapes2021": [], "nameStyles": ["annulled rows", "caps", "hyphenated"]},
  {"mir": "17", "name": "Пловдив област", "layout2604": "batches", "batches2604": 8, "emptiedBatches2604": 0, "numberShapes2604": ["N/dd.mm.yyyy", "N/ dd.mm.yyyy", "N/dd.mm.yyyy г.", "N / dd.mm.yyyy"], "numberShapes2021": [], "nameStyles": ["4+ words", "caps", "hyphenated"]},
  {"mir": "18", "name": "Разград", "layout2604": "growing-table", "batches2604": 1, "emptiedBatches2604": 0, "numberShapes2604": ["С-N/dd.mm.yyyy год.", "Рз-N/dd.mm.yyyy год.", "Кт-N/dd.mm.yyyy год.", "N/dd.mm.yyyy г.", "Рз-Ndd.mm.yyyy год."], "numberShapes2021": ["Рз-N/dd.mm.yyyy", "Рз-N/dd.mmyyyy", "РЗ-N/ dd.mm.yyyy"], "nameStyles": ["caps"]},
  {"mir": "19", "name": "Русе", "layout2604": "growing-table", "batches2604": 1, "emptiedBatches2604": 0, "numberShapes2604": ["N/dd.mm.yyyy", "N/dd.mm.yyyy г."], "numberShapes2021": [], "nameStyles": ["annulled rows"]},
  {"mir": "20", "name": "Силистра", "layout2604": "growing-table", "batches2604": 1, "emptiedBatches2604": 0, "numberShapes2604": ["N/dd.mm.yyyy", "N/dd.mm.yyyy г."], "numberShapes2021": [], "nameStyles": ["annulled rows", "caps"]},
  {"mir": "21", "name": "Сливен", "layout2604": "growing-table", "batches2604": 1, "emptiedBatches2604": 0, "numberShapes2604": ["N/dd.mm.yyyy г.", "N/dd.mm.yyyy"], "numberShapes2021": ["N/dd.mm.yyyy"], "nameStyles": ["annulled rows"]},
  {"mir": "22", "name": "Смолян", "layout2604": "growing-table", "batches2604": 1, "emptiedBatches2604": 0, "numberShapes2604": ["N/dd.mm.yyyy г.", "N/dd.mm.yyyy"], "numberShapes2021": ["N/dd.mm.yyyy"], "nameStyles": ["hyphenated"]},
  {"mir": "23", "name": "София 23 МИР", "layout2604": "growing-table", "batches2604": 1, "emptiedBatches2604": 0, "numberShapes2604": ["N/dd.mm.yyyy", "N/dd.mm.yyyy г."], "numberShapes2021": ["N от dd.mm.yyyy г.", "N/dd.mm.yyyy г."], "nameStyles": ["2 words", "4+ words", "annulled rows", "hyphenated"]},
  {"mir": "24", "name": "София 24 МИР", "layout2604": "growing-table", "batches2604": 1, "emptiedBatches2604": 0, "numberShapes2604": ["N/dd.mm.yyyy", "N/dd.mm.yyyy г."], "numberShapes2021": ["N от dd.mm.yyyy г."], "nameStyles": ["4+ words", "annulled rows", "hyphenated"]},
  {"mir": "25", "name": "София 25 МИР", "layout2604": "batches", "batches2604": 5, "emptiedBatches2604": 4, "numberShapes2604": ["N/dd.mm.yyyy", "N/dd.mm.yyyy г.", ""], "numberShapes2021": ["N от dd.mm.yyyy г."], "nameStyles": ["annulled rows", "caps", "hyphenated"]},
  {"mir": "26", "name": "София област", "layout2604": "growing-table", "batches2604": 1, "emptiedBatches2604": 0, "numberShapes2604": ["N/dd.mm.yyyy", "N/ dd.mm.yyyy г."], "numberShapes2021": ["N от dd.mm.yyyy г."], "nameStyles": ["annulled rows", "hyphenated"]},
  {"mir": "27", "name": "Стара Загора", "layout2604": "growing-table", "batches2604": 1, "emptiedBatches2604": 0, "numberShapes2604": ["N/dd.mm.yyyy"], "numberShapes2021": ["N / dd.mm.yyyy"], "nameStyles": ["annulled rows"]},
  {"mir": "28", "name": "Търговище", "layout2604": "growing-table", "batches2604": 1, "emptiedBatches2604": 0, "numberShapes2604": ["N/dd.mm.yyyy", "N/dd.mm.yyyy г."], "numberShapes2021": [], "nameStyles": []},
  {"mir": "29", "name": "Хасково", "layout2604": "growing-table", "batches2604": 1, "emptiedBatches2604": 0, "numberShapes2604": ["N/dd.mm.yyyy", "N/dd.mm.yyyyг.", "N/dd.mm.yyyy г."], "numberShapes2021": ["N/ dd.mm.yyyyГ."], "nameStyles": ["annulled rows", "hyphenated"]},
  {"mir": "30", "name": "Шумен", "layout2604": "growing-table", "batches2604": 1, "emptiedBatches2604": 0, "numberShapes2604": ["N/dd.mm.yyyy г.", "N/dd.mm.yyyy", "N/dd.mm.yyyyг."], "numberShapes2021": [], "nameStyles": ["annulled rows", "caps", "hyphenated"]},
  {"mir": "31", "name": "Ямбол", "layout2604": "growing-table", "batches2604": 1, "emptiedBatches2604": 0, "numberShapes2604": ["N/dd.mm.yyyy"], "numberShapes2021": ["N/dd.mm.yyyy"], "nameStyles": []},
]
