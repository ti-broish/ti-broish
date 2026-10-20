# Infra

OpenTofu for the Da Bulgaria Cloudflare account (`579692914a155ab268c22b814cbf8a05`).

This first slice only attaches the staging Worker to `d1t.tibroish.bg`. It does not change production `tibroish.bg`, mail, or the existing signup workers.

```bash
cd infra
tofu init
tofu plan
```

The API token needs Workers Routes write on this account. Do not apply until `ti-broish-web-staging` is deployed. If the route already exists, import it:

```bash
tofu import cloudflare_workers_route.staging_web <zone_id>/<route_id>
```

State is local for now. Do not commit `terraform.tfstate`.

Other directories have their own state: `infra/email`, `infra/github`, `infra/photos` (the proxied MinIO origin for `/photos`) and `infra/google` (Google Cloud project `ti-broish`, Drive API and the manual OAuth client for пълномощни uploads).
