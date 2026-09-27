# How a change ships

Open a pull request into `main`. Do not push to `main`, do not publish a release, and do not deploy with Wrangler from this machine.

The `Web` workflow runs the unit tests and the browser tests in parallel. The job named `check` passes only when both do. When that workflow succeeds, `Automerge` squash-merges the pull request only if the author is a member of the `ti-broish` organization and the branch is in this repository. It also skips drafts, the `hold` label, and an open review thread. No approving review is required. Pull requests from forks or other GitHub users stay open for a person to merge.

The merge to `main` deploys staging through the existing Cloudflare Workers Build for `ti-broish-web-staging` at `d1t.tibroish.bg`. Release Drafter updates the draft release at the same time, so the notes show everything since the previous release.

Publishing that draft, including from the GitHub phone app, is the production action. It deploys `ti-broish-web` only when the repository variable `PRODUCTION_ENABLED` is `true` and the `CLOUDFLARE_API_TOKEN` secret belongs to the Да България account. Until then a published release changes nothing on `tibroish.bg`. The production worker has no route and no database yet.
