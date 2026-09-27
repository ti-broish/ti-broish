# Ти Броиш

Monorepo for the new public site and signup.

- `apps/web` is a TanStack Start app on Cloudflare Workers. It is the clickable staging prototype: campaign pages, the signup flow, and the profile.
- `infra` is OpenTofu for the staging Worker route on `d1t.tibroish.bg`. Production `tibroish.bg` is not in this slice.
- EmDash will own the editable public pages. The prototype serves those pages from `apps/web` so staging is one clickable site.

Staging data stays in the browser. Email confirmation is simulated.

## Shipping a change

A pull request into `main` runs the web checks. A green check is squash-merged unless the pull request is a draft, labelled `hold`, or has an open review thread. The merge updates staging at `d1t.tibroish.bg` and refreshes the draft release.

On a phone, open the draft under Releases, read what changed since the last release, and publish it when that set should be the next production deploy. Publishing does nothing to production until `PRODUCTION_ENABLED` is set. `tibroish.bg` is not a target of this app yet.

```bash
cd apps/web
pnpm install
pnpm dev
```
