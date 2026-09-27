import { Link, createFileRoute } from '@tanstack/react-router'
import { PageIntro } from '../../components/SiteChrome'

export const Route = createFileRoute('/admin/')({
  component: AdminHome,
})

function AdminHome() {
  return (
    <div className="grid gap-6">
      <PageIntro title="Админ" lede="Три отделни места: кой влиза, записаните хора и разпределението по секции." />
      <div className="grid gap-3">
        <Link to="/admin/access" className="rounded-2xl border border-[#ddd] p-4 font-bold">
          Достъп
          <span className="mt-1 block font-normal">Покани, роли и махане от екипа.</span>
        </Link>
        <Link to="/admin/signups" className="rounded-2xl border border-[#ddd] p-4 font-bold">
          Записвания
          <span className="mt-1 block font-normal">Списък, филтри, CSV и хора, въведени от екипа.</span>
        </Link>
        <Link to="/admin/sections" className="rounded-2xl border border-[#ddd] p-4 font-bold">
          Секции
          <span className="mt-1 block font-normal">Чернови, публикуване и заети секции.</span>
        </Link>
      </div>
    </div>
  )
}
