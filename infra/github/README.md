# GitHub repository settings

OpenTofu for `ti-broish/ti-broish`. This directory has its own state. Do not apply it together with `infra/`, and do not commit `terraform.tfstate` or `.terraform`.

`delete_branch_on_merge` removes the head branch when a person merges a pull request, including a squash. A squash made by the Automerge action uses `GITHUB_TOKEN`, and GitHub does not run that automatic deletion for it. The action deletes the head branch itself after the merge.

The provider reads `GITHUB_TOKEN` when `token` is unset. Leave `GITHUB_OWNER` unset so `owner = "ti-broish"` is the account that is planned.

```bash
cd infra/github
export GITHUB_TOKEN=$(gh auth token)
tofu init
tofu plan
tofu apply
```
