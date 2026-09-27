# GitHub repository settings for ti-broish/ti-broish.
# Own state. Do not apply this directory together with infra/ (the Cloudflare staging route).

provider "github" {
  owner = "ti-broish"
}

import {
  to = github_repository.ti_broish
  id = "ti-broish"
}

resource "github_repository" "ti_broish" {
  name                   = "ti-broish"
  visibility             = "public"
  delete_branch_on_merge = true

  has_issues      = true
  has_projects    = false
  has_wiki        = false
  has_discussions = false

  allow_merge_commit = true
  allow_squash_merge = true
  allow_rebase_merge = true
  allow_auto_merge   = false

  lifecycle {
    ignore_changes = [
      description,
      homepage_url,
      topics,
      pages,
      security_and_analysis,
      template,
      has_downloads,
      vulnerability_alerts,
      web_commit_signoff_required,
      allow_update_branch,
      squash_merge_commit_title,
      squash_merge_commit_message,
      merge_commit_title,
      merge_commit_message,
    ]
  }
}
