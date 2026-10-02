# Ти Броиш

Monorepo for the new public site and signup.

- `apps/web` is a TanStack Start app on Cloudflare Workers. It is the clickable staging prototype: campaign pages, the signup flow, and the profile.
- `infra` is OpenTofu for the staging Worker route on `d1t.tibroish.bg`. Production hostnames for `ti-broish-web` live in `apps/web/wrangler.jsonc`.
- EmDash will own the editable public pages. The prototype serves those pages from `apps/web` so staging is one clickable site.

Staging signups are stored in D1. `/admin` lists them for the team: export all, one MIR, or abroad; import taken sections and people who still have to confirm. A draft section stays internal until it is published. Mass section mail stays a Brevo campaign from the admin CSV. Cloudflare Email Sending is only for the confirmation code and the imported-person link, and it sends after `tibroish.bg` is onboarded in the Да България account. Until that send works, the confirmation code stays on the page. `/admin` opens for a confirmed profile whose email is on the team. The first admins are the comma-separated `ADMIN_EMAILS` worker variable. An admin invites the rest from the team panel. A viewer can look, an editor can draft and export the Brevo file, and an admin can publish, export the internal file, and invite.

## Shipping a change

A pull request into `main` runs the web checks. A green check is squash-merged when the author is in the `ti-broish` organization and the branch is in this repository, unless the pull request is a draft, labelled `hold`, or has an open review thread. Pull requests from outside the organization stay open. The merge updates staging at `d1t.tibroish.bg` and refreshes the draft release.

On a phone, open the draft under Releases, read what changed since the last release, and publish it when that set should be the next production deploy. Publishing does nothing until `PRODUCTION_ENABLED` is set. The production worker `ti-broish-web` is deployed from `main` to `tibroish.bg` and `www.tibroish.bg`, with its own D1 database `ti-broish-signup`. `next.tibroish.bg` redirects there. The build sets `CLOUDFLARE_ENV=production` before Vite runs, so the flattened config is that production environment. Staging stays on `d1t.tibroish.bg`.

```bash
cd apps/web
pnpm install
pnpm dev
```
