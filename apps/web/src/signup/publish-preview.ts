/** The confirmation for „Публикувай черновите в този изглед“: how many volunteers and how many „И аз“. */
export function describePublishPreview(input: { volunteers: number; partners: number; mismatched?: number }) {
  const volunteers = input.volunteers === 1 ? '1 доброволец' : `${input.volunteers} доброволци`
  const partners = `${input.partners} от „И аз“`
  const stopped = input.mismatched ? ` Спрени: ${input.mismatched} със секция извън МИР на пълномощното.` : ''
  return `Ще публикуваме ${volunteers} и ${partners} (без имейл, без Brevo).${stopped}`
}

/** The armed button's label. */
export function publishConfirmLabel(input: { volunteers: number; partners: number }) {
  const volunteers = input.volunteers === 1 ? '1 доброволец' : `${input.volunteers} доброволци`
  return `Да, публикувай ${volunteers} и ${input.partners} от „И аз“ (без имейл)`
}
