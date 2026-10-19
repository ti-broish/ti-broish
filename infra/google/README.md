# Google Cloud (Drive for пълномощни)

OpenTofu for the existing Google Cloud project `ti-broish`. The Worker uses it to upload signed пълномощни to Google Drive from `/admin/palnomoshtni`. This directory has its own local state. Do not apply it together with `infra/`, and do not commit `terraform.tfstate` or `.terraform`.

What Tofu manages:

- reads the project (it never creates or deletes it),
- `drive.googleapis.com`, imported because it was already enabled.

What Tofu cannot manage: the OAuth consent screen and the OAuth client. The google provider only has `google_iap_brand` / `google_iap_client`, which create **Internal** brands for IAP inside an organisation. This project has no organisation and the app must be **External**, so those two are created by hand (below).

## Plan and apply

Tofu uses Application Default Credentials. Log in as an account with `roles/owner` (or `roles/serviceusage.serviceUsageAdmin`) on `ti-broish`:

```bash
gcloud auth application-default login            # as hkdobrev@gmail.com
gcloud auth application-default set-quota-project ti-broish
cd infra/google
tofu init
tofu plan
tofu apply
```

No billing account is needed to enable the Drive API.

## OAuth client (manual, once)

The Worker uses the OAuth refresh-token trio (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`). Files are owned by the Google account that consents, so use the account that owns the Drive folders (for staging: `hkdobrev@gmail.com`, which owns „ТЕСТ пълномощни staging“).

1. Consent screen (`tofu output oauth_consent_screen_url`): User type **External**, app name „Ти броиш пълномощни“, support and developer email = the owner account.
2. Data access: add the scope `https://www.googleapis.com/auth/drive`. It is restricted, which is fine for the owner's own account.
3. Audience: **Publish app** to *In production*. In *Testing*, Google expires refresh tokens after 7 days. Leaving it unverified is fine for a single user; the consent page shows an "unverified app" warning that the owner can accept.
4. Client (`tofu output oauth_clients_url`): **Create client** → Web application, name `ti-broish-worker-drive`, authorised redirect URI `https://developers.google.com/oauthplayground`.
5. Refresh token: open the [OAuth 2.0 Playground](https://developers.google.com/oauthplayground), click the gear icon, tick „Use your own OAuth credentials“ and paste the client id and secret. Enter the scope `https://www.googleapis.com/auth/drive`, authorise as the owner account, then **Exchange authorization code for tokens** and copy the refresh token.
6. Put the three values into both Workers without echoing them:

```bash
cd apps/web
pnpm exec wrangler secret put GOOGLE_OAUTH_CLIENT_ID
pnpm exec wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET
pnpm exec wrangler secret put GOOGLE_OAUTH_REFRESH_TOKEN
pnpm exec wrangler secret put GOOGLE_OAUTH_CLIENT_ID --env production
pnpm exec wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET --env production
pnpm exec wrangler secret put GOOGLE_OAUTH_REFRESH_TOKEN --env production
```

Store them in 1Password too. The health line on `/admin/palnomoshtni` then shows whether the token works and the folder is reachable. Production also needs its own `DESIGNATION_DRIVE_FOLDER_ID`.

Revoking the app at https://myaccount.google.com/permissions invalidates the refresh token; repeat step 5 after that.
