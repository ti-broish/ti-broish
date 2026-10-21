import { DESIGNATION_MIR_MISMATCH, designationMirMismatch } from '../../signup/designation-mir-guard'

/** „Секция извън МИР на пълномощното“: a numbered person's section is in another МИР. Publishing it is refused. */
export function DesignationMirBadge(props: { designationMir?: string | null; designationNumber?: string | number | null; section?: string | null }) {
  const mismatch = designationMirMismatch({ designationMir: props.designationMir, designationNumber: props.designationNumber, section: props.section })
  if (!mismatch) return null
  return (
    <span
      data-testid="designation-mir-badge"
      title={`Секцията е в МИР ${mismatch.sectionMir}, пълномощното е за МИР ${mismatch.designationMir}. Не може да се публикува.`}
      className="inline-flex min-h-6 items-center rounded-full bg-[#8f1d1d] px-2 text-xs font-black text-white"
    >
      ⚠ {DESIGNATION_MIR_MISMATCH} ({mismatch.sectionMir} ≠ {mismatch.designationMir})
    </span>
  )
}
