# Ти Броиш

Monorepo for the new public site and signup.

- `apps/web` is a TanStack Start app on Cloudflare Workers. It is the clickable staging prototype: campaign pages, the signup flow, and the profile.
- `infra` is OpenTofu for the staging Worker route on `d1t.tibroish.bg`. Production hostnames for `ti-broish-web` live in `apps/web/wrangler.jsonc`.
- EmDash will own the editable public pages. The prototype serves those pages from `apps/web` so staging is one clickable site.

Staging signups are stored in D1. `/admin` lists them for the team: export all, one MIR, or abroad; import taken sections and people who still have to confirm. A draft section stays internal until it is published. Mass section mail stays a Brevo campaign from the admin CSV. There is also a Brevo sections CSV that updates existing contacts by EMAIL with SECTION, SECTION_ADDRESS, and SECTION_PLACE. It is on `/admin/sections` above the distribution buttons, for the MIR, abroad and search shown there, and in the signups tools. Cloudflare Email Sending is only for the confirmation code and the imported-person link, and it sends after `tibroish.bg` is onboarded in the Да България account. Until that send works, the confirmation code stays on the page. `/admin` opens for a confirmed profile whose email is on the team. The first admins are the comma-separated `ADMIN_EMAILS` worker variable. An admin invites the rest from the team panel. A viewer can look, an editor can draft and export the Brevo file, and an admin can publish, export the internal file, and invite.

## Shipping a change

A pull request into `main` runs the web checks. A green check is squash-merged when the author is in the `ti-broish` organization and the branch is in this repository, unless the pull request is a draft, labelled `hold`, or has an open review thread. Pull requests from outside the organization stay open. The merge updates staging at `d1t.tibroish.bg` and refreshes the draft release.

On a phone, open the draft under Releases, read what changed since the last release, and publish it when that set should be the next production deploy. Publishing does nothing until `PRODUCTION_ENABLED` is set. The production worker `ti-broish-web` is deployed from `main` to `tibroish.bg` and `www.tibroish.bg`, with its own D1 database `ti-broish-signup`. `next.tibroish.bg` redirects there. The build sets `CLOUDFLARE_ENV=production` before Vite runs, so the flattened config is that production environment. Staging stays on `d1t.tibroish.bg`.

```bash
cd apps/web
pnpm install
pnpm dev
```

## Пълномощни (designation PDFs)

Per-person legal PDF «Пълномощно» for a committee representative (`представител`) on election day. This is a different document from the static ЦИК distinctive-sign (badge) at `/znachka` and `apps/web/public/oznachenie-predstavitel.pdf` — leave that page untouched.

The generator lives in `apps/web/src/signup/designation-pdf.ts`. A local admin script uploads each PDF to a Google Drive folder (anyone-with-the-link viewer), stores the URL on the signup row, and copies it to the person's Brevo contact. Staff can preview one PDF at `GET /admin/signups/{id}/palnomoshtno.pdf`.

### How to run

From `apps/web`:

```bash
# One fake PDF (no DB). Writes designation-sample.pdf under --out.
pnpm designation-pdfs --sample --out /tmp/designation-sample.pdf

# Plan only: who would get a number, no files, no D1, no Drive, no Brevo.
pnpm designation-pdfs --env local --dry-run

# Generate PDFs from the local D1 and write numbers back. No Drive/Brevo.
pnpm designation-pdfs --env local --local-only --out ./designation-pdfs

# Staging remote D1 + Drive + Brevo (needs secrets). --person and --limit narrow the set.
pnpm designation-pdfs --env staging --person <id>
pnpm designation-pdfs --env staging --limit 5 --force
```

`--env production` talks to production D1 with `--remote`. Do not run that from a laptop unless you mean it. `--force` re-renders and updates the existing Drive file in place so the URL stays stable. Already numbered people keep their number.

### Secrets and config

Never commit these. Grantor name and ЕГН are personal data — only env/CLI.

| Variable | Purpose |
| --- | --- |
| `DRIVE_FOLDER_ID` | Shared Drive folder to upload into |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Service-account JSON (file path or inline). Scope defaults to `drive.file`; set `GOOGLE_DRIVE_SCOPE=https://www.googleapis.com/auth/drive` if the folder is on a Shared Drive |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` / `GOOGLE_OAUTH_REFRESH_TOKEN` | Optional alternative to the service account |
| `BREVO_API_KEY` | Same key as signup mail. Attribute name defaults to `PALNOMOSHTNO_URL` (override with `BREVO_DESIGNATION_ATTRIBUTE`) |
| `DESIGNATION_GRANTOR_NAME` | Full name of the упълномощител |
| `DESIGNATION_GRANTOR_EGN` | ЕГН of the упълномощител |
| `DESIGNATION_GRANTOR_AUTHORISATION` | Optional clause after the grantor, e.g. `упълномощен/а с пълномощно № … от …` |
| `DESIGNATION_GRANTOR_CAPACITY` | `пълномощник` (default, verb ПРЕУПЪЛНОМОЩАВАМ) or `представляващ` (УПЪЛНОМОЩАВАМ) |
| `DESIGNATION_ISSUED_ON` | Date of issue, `dd.mm.yyyy` or ISO. Default: today in Europe/Sofia |
| `DESIGNATION_VALID_UNTIL` | Default `02.11.2026` |
| `DESIGNATION_SEAL_LINE` | Default `Инициативният комитет не разполага с печат!` |
| `DESIGNATION_NUMBER_PREFIX` | Optional prefix in front of the sequential integer |
| `DESIGNATION_SECTION_INFO` | Set to `0` to omit the non-operative section info line |

Service accounts have no My Drive quota. Put `DRIVE_FOLDER_ID` in a Shared Drive and add the service account as Content manager. Create the Brevo contact attribute `PALNOMOSHTNO_URL` (text) before the first sync.

The Worker preview route reads the same `DESIGNATION_GRANTOR_*` values from wrangler secrets/vars so the downloaded PDF matches the batch.

### Legal TODOs that still need confirmation

- Seal line: confirm that the initiative committee has no seal, or set `DESIGNATION_SEAL_LINE`.
- Grantor: who signs (Пендачанска / Вълков as representing, or a пълномощник with an authorisation clause), their names and ЕГН.
- `DESIGNATION_VALID_UNTIL` (default the day after the possible runoff).
- Distinctive sign is still the static `/znachka` PDF (ЦИК Решение № 61-ПВР); this script does not generate badges.
