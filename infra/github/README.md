# GitHub repository settings

OpenTofu for `ti-broish/ti-broish`. This directory has its own state. Do not apply it together with `infra/`, and do not commit `terraform.tfstate` or `.terraform`.

`delete_branch_on_merge` removes the head branch when a pull request is merged.

The provider reads `GITHUB_TOKEN` when `token` is unset. Leave `GITHUB_OWNER` unset so `owner = "ti-broish"` is the account that is planned.

```bash
cd infra/github
export GITHUB_TOKEN=$(gh auth token)
tofu init
tofu plan
tofu apply
```
