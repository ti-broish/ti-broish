# Email sending DNS

OpenTofu for the Cloudflare Email Sending records on `cf-bounce.tibroish.bg`.

This root does not change the apex SPF or MX. Those stay with Brevo. It also does not apply the staging Worker route in `infra/`.

```bash
cd infra/email
tofu init
tofu plan
tofu apply
```

The token needs DNS edit on zone `tibroish.bg`. State stays on this machine. Do not commit it.

DKIM (`cf-bounce._domainkey`) is created when `tibroish.bg` is onboarded for Email Sending. That key is not invented here.
