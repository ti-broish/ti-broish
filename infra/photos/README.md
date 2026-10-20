# Photos origin

OpenTofu for `minio-origin.tibroish.bg`, the origin the web Worker uses for `tibroish.bg/photos/<key>` and `d1t.tibroish.bg/photos/<key>`.

- A proxied `A` record `minio-origin.tibroish.bg` to MinIO at `185.117.80.46`.
- An Origin Rule that sends that host to port `9443`.
- A Configuration Rule that sets SSL mode Full (not strict) for that host only, because MinIO has a self-signed certificate. The zone SSL mode does not change.

```bash
cd infra/photos
tofu init
tofu plan
tofu apply
```

The token needs DNS edit, Origin Rules edit and Config Rules edit (Zone Rulesets) on zone `tibroish.bg` in the Da Bulgaria account. State stays on this machine. Do not commit it.

A zone has one entry-point ruleset per phase. If `plan` or `apply` reports that an `http_request_origin` or `http_config_settings` ruleset already exists, import it and copy its existing rules into `origin.tf` before you apply:

```bash
tofu import cloudflare_ruleset.origin zones/<zone_id>/<ruleset_id>
tofu import cloudflare_ruleset.config zones/<zone_id>/<ruleset_id>
```

Check it:

```bash
curl -sI https://minio-origin.tibroish.bg/minio/health/live   # 200
curl -sI https://tibroish.bg/photos/<key>                    # 200 image/*
curl -sI https://tibroish.bg/photos/missing.jpg              # 404
```
