# Origin for the public photos at tibroish.bg/photos/<key>.
# The web Worker cannot fetch a bare IP and does not trust MinIO's self-signed
# certificate, so it fetches minio-origin.tibroish.bg instead. Cloudflare proxies
# that name to MinIO on 185.117.80.46:9443 with SSL mode Full for this host only.
# The zone SSL mode is not changed.

provider "cloudflare" {}

variable "zone_id" {
  type    = string
  default = "0c635b10986f6bd823012916013882ef"
}

variable "origin_hostname" {
  type    = string
  default = "minio-origin.tibroish.bg"
}

variable "minio_ip" {
  type    = string
  default = "185.117.80.46"
}

variable "minio_port" {
  type    = number
  default = 9443
}

locals {
  origin_expression = "(http.host eq \"${var.origin_hostname}\")"
}

resource "cloudflare_dns_record" "minio_origin" {
  zone_id = var.zone_id
  name    = var.origin_hostname
  type    = "A"
  content = var.minio_ip
  proxied = true
  ttl     = 1
  comment = "MinIO origin for tibroish.bg/photos (web Worker fetches it)"
}

# Zone entry point for Origin Rules. If the zone already has one, import it and
# copy its existing rules in here before applying, or the apply replaces them.
resource "cloudflare_ruleset" "origin" {
  zone_id = var.zone_id
  name    = "Origin rules"
  kind    = "zone"
  phase   = "http_request_origin"

  rules = [
    {
      description = "MinIO photos origin on port ${var.minio_port}"
      expression  = local.origin_expression
      action      = "route"
      action_parameters = {
        origin = {
          port = var.minio_port
        }
      }
      enabled = true
    },
  ]
}

# Zone entry point for Configuration Rules. Same import note as above.
resource "cloudflare_ruleset" "config" {
  zone_id = var.zone_id
  name    = "Configuration rules"
  kind    = "zone"
  phase   = "http_config_settings"

  rules = [
    {
      description = "MinIO has a self-signed certificate: SSL Full, not strict, for this host only"
      expression  = local.origin_expression
      action      = "set_config"
      action_parameters = {
        ssl = "full"
      }
      enabled = true
    },
  ]
}
