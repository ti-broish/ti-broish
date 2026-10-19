output "project_id" {
  value = data.google_project.this.project_id
}

output "project_number" {
  description = "The OAuth client id starts with this number."
  value       = data.google_project.this.number
}

output "drive_api" {
  value = google_project_service.drive.service
}

output "oauth_consent_screen_url" {
  value = "https://console.cloud.google.com/auth/branding?project=${var.project_id}"
}

output "oauth_clients_url" {
  value = "https://console.cloud.google.com/auth/clients?project=${var.project_id}"
}
