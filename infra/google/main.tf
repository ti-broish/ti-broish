# The project already exists (personal project, no organisation). Tofu reads it
# and manages only the APIs it needs. It never creates or deletes the project.
data "google_project" "this" {
  project_id = var.project_id
}

# Drive API for the Worker's пълномощни uploads (/admin/palnomoshtni).
resource "google_project_service" "drive" {
  project = var.project_id
  service = "drive.googleapis.com"

  # Keep the API on even if this resource is removed from code.
  disable_on_destroy         = false
  disable_dependent_services = false
}

# drive.googleapis.com was enabled by hand before this config existed.
import {
  to = google_project_service.drive
  id = "${var.project_id}/drive.googleapis.com"
}

# The OAuth consent screen and the OAuth client are NOT managed here.
# google_iap_brand / google_iap_client only create Internal brands for IAP in
# an organisation; this project has no organisation and the app must be
# External. Create them in the console — see README.md.
