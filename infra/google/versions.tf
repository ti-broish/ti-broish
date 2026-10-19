terraform {
  required_version = ">= 1.8.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

provider "google" {
  project = var.project_id
  # User ADC (gcloud's own OAuth client) needs a quota project for the
  # Service Usage API. Bill those calls to this project.
  billing_project       = var.project_id
  user_project_override = true
}
