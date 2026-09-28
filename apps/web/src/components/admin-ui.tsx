export const adminInput =
  'min-h-11 rounded-xl border-2 border-[#4a314f] bg-white px-3 text-[#1a1020] outline-none placeholder:text-[#5c5160] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2b062f]'

export const adminGhost =
  'inline-flex min-h-11 items-center justify-center rounded-full border-2 border-[#2b062f] bg-white px-4 text-sm font-bold text-[#2b062f] hover:bg-[#f6f1f7] disabled:cursor-not-allowed disabled:opacity-40'

export const adminChipOn = 'inline-flex min-h-11 items-center justify-center rounded-full bg-[#2b062f] px-4 text-sm font-bold text-white'

export function AdminHeading({ title, lede }: { title: string; lede?: string }) {
  return (
    <header className="grid gap-1">
      <h1 className="text-2xl font-black text-[#1a1020]">{title}</h1>
      {lede ? <p className="max-w-3xl text-sm leading-6 text-[#333]">{lede}</p> : null}
    </header>
  )
}
