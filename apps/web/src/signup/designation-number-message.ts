/** Result line of „Номерирай“: how many got a number, and how many the ЕГН guard skipped. */
export function numberingMessage(assigned: number, duplicates: number, covered: number) {
  const tail = [
    duplicates ? `пропуснати ${duplicates} (дубликат по ЕГН)` : '',
    covered ? `пропуснати ${covered} (покрит от доброволец)` : '',
  ].filter(Boolean)
  if (assigned === 0 && tail.length === 0) return 'Всички с публикувана секция вече имат номер.'
  const head = assigned === 0 ? 'Няма нови за номериране' : `Номерирани ${assigned} души`
  return tail.length ? `${head}; ${tail.join(', ')}.` : `${head}.`
}
