# Ти Броиш

Monorepo for the new public site and signup.

- `apps/web` is a TanStack Start app on Cloudflare Workers. It is the clickable staging prototype: campaign pages, the signup flow, and the profile.
- `infra` is OpenTofu for the staging Worker route on `d1t.tibroish.bg`. Production `tibroish.bg` is not in this slice.
- EmDash will own the editable public pages. The prototype serves those pages from `apps/web` so staging is one clickable site.

Staging signups are stored in D1. `/admin` lists them for the team: export all, one MIR, or abroad; import taken sections and people who still have to confirm. A draft section stays internal until it is published. Mass section mail stays a Brevo campaign from the admin CSV. Cloudflare Email Sending is only for the confirmation code and the imported-person link, and it sends after `tibroish.bg` is onboarded in the Да България account. Until that send works, the confirmation code stays on the page. `/admin` on staging stays closed until the `ADMIN_TOKEN` secret is set on the worker; localhost is open without it.

## Shipping a change

A pull request into `main` runs the web checks. A green check is squash-merged when the author is in the `ti-broish` organization and the branch is in this repository, unless the pull request is a draft, labelled `hold`, or has an open review thread. Pull requests from outside the organization stay open. The merge updates staging at `d1t.tibroish.bg` and refreshes the draft release.

On a phone, open the draft under Releases, read what changed since the last release, and publish it when that set should be the next production deploy. Publishing does nothing to production until `PRODUCTION_ENABLED` is set. `tibroish.bg` is not a target of this app yet.

```bash
cd apps/web
pnpm install
pnpm dev
```
