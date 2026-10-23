/** Result line of „Номерирай“: how many got a number, how many the ЕГН guard skipped, and volunteers without a МИР. */
export function numberingMessage(assigned: number, duplicates: number, covered: number, noMir = 0) {
  const tail = [
    duplicates ? `пропуснати ${duplicates} (дубликат по ЕГН)` : '',
    covered ? `пропуснати ${covered} (покрит от доброволец)` : '',
    noMir ? `без МИР ${noMir} (избери район в профила, за да получат номер)` : '',
  ].filter(Boolean)
  if (assigned === 0 && tail.length === 0) return 'Всички вече имат номер.'
  const head = assigned === 0 ? 'Няма нови за номериране' : `Номерирани ${assigned} души`
  return tail.length ? `${head}; ${tail.join(', ')}.` : `${head}.`
}
