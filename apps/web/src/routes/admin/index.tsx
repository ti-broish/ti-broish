import { Link, createFileRoute } from '@tanstack/react-router'
import { useAdminAccess } from '../../components/AdminShell'
import { AdminHeading } from '../../components/admin-ui'
import { defaultSectionSearch, defaultSignupSearch, type SignupSearch } from '../../signup/admin-search'

export const Route = createFileRoute('/admin/')({
  component: AdminHome,
})

function AdminHome() {
  const access = useAdminAccess()
  const { summary } = access
  return (
    <div className="grid gap-6">
      <AdminHeading title="Начало" lede={`${access.email} · екипът и записаните хора на едно място.`} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat to="/admin/signups" search={{ ...defaultSignupSearch, view: 'all' }} label="Записани" value={summary.total} detail="Всички редове в базата." />
        <Stat to="/admin/signups" search={{ ...defaultSignupSearch, view: 'assigned' }} label="Със секция" value={summary.assigned} detail="Имат публикувана секция." />
        <Stat to="/admin/signups" search={{ ...defaultSignupSearch, view: 'unassigned' }} label="Без секция" value={summary.unassigned} detail="Още без публикувана секция." />
        <Stat to="/admin/signups" search={{ ...defaultSignupSearch, view: 'calls' }} label="Обаждания" value={summary.calls} detail="Поискали са разговор." />
        <Stat to="/admin/access" label="Екип" value={summary.staff} detail="Хора с достъп до админа." />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Link to="/admin/signups" search={defaultSignupSearch} className="rounded-2xl border-2 border-[#2b062f] bg-[#f6f1f7] p-4 text-[#1a1020] no-underline hover:bg-[#e7dce9]">
          <span className="block text-lg font-black text-[#2b062f]">Записвания</span>
          <span className="mt-1 block text-sm text-[#333]">Търсене, таблица, CSV и въвеждане от екипа.</span>
        </Link>
        <Link to="/admin/sections" search={defaultSectionSearch} className="rounded-2xl border-2 border-[#2b062f] bg-[#f6f1f7] p-4 text-[#1a1020] no-underline hover:bg-[#e7dce9]">
          <span className="block text-lg font-black text-[#2b062f]">Секции</span>
          <span className="mt-1 block text-sm text-[#333]">Чернови, публикуване и заети секции.</span>
        </Link>
        <Link to="/admin/access" className="rounded-2xl border-2 border-[#2b062f] bg-[#f6f1f7] p-4 text-[#1a1020] no-underline hover:bg-[#e7dce9]">
          <span className="block text-lg font-black text-[#2b062f]">Достъп</span>
          <span className="mt-1 block text-sm text-[#333]">Покани, роли и махане от екипа.</span>
        </Link>
      </div>
    </div>
  )
}

function Stat({
  to,
  search,
  label,
  value,
  detail,
}: {
  to: '/admin/signups' | '/admin/access'
  search?: SignupSearch
  label: string
  value: number
  detail: string
}) {
  const className = 'grid gap-1 rounded-2xl border-2 border-[#2b062f] bg-white p-4 text-[#1a1020] no-underline hover:bg-[#f6f1f7]'
  const body = (
    <>
      <span className="text-sm font-bold">{label}</span>
      <span className="text-3xl font-black text-[#2b062f]">{value}</span>
      <span className="text-sm text-[#333]">{detail}</span>
    </>
  )
  if (to === '/admin/signups' && search) {
    return (
      <Link to={to} search={search} className={className}>
        {body}
      </Link>
    )
  }
  return (
    <Link to="/admin/access" className={className}>
      {body}
    </Link>
  )
}


