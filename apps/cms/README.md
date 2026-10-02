# Ти Броиш CMS

EmDash admin. Public pages stay on the signup app. This worker serves `/_emdash/*` and `/_astro/*`.

Staging editor: [https://d1t.tibroish.bg/_emdash/admin](https://d1t.tibroish.bg/_emdash/admin).

Production editor: [https://tibroish.bg/_emdash/admin](https://tibroish.bg/_emdash/admin). `wrangler deploy` without `--env` stays on staging. Production is `wrangler deploy --env production`.

```bash
pnpm install
pnpm dev
```

Local admin: http://localhost:4321/_emdash/admin
