import { createFileRoute } from '@tanstack/react-router'
import { AdminShell } from '../../components/AdminShell'

export const Route = createFileRoute('/admin')({
  component: AdminShell,
})
