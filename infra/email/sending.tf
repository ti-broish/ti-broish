# Sending DNS for Cloudflare Email Service.
# These records live on cf-bounce.tibroish.bg.
# The apex SPF and MX stay on Brevo and are not managed here.

provider "cloudflare" {}

variable "zone_id" {
  type    = string
  default = "0c635b10986f6bd823012916013882ef"
}

resource "cloudflare_dns_record" "sending_spf" {
  zone_id = var.zone_id
  name    = "cf-bounce.tibroish.bg"
  type    = "TXT"
  content = "v=spf1 include:_spf.mx.cloudflare.net ~all"
  ttl     = 1
  comment = "Cloudflare Email Sending SPF"
}

resource "cloudflare_dns_record" "sending_mx" {
  for_each = {
    route1 = 12
    route2 = 31
    route3 = 86
  }
  zone_id  = var.zone_id
  name     = "cf-bounce.tibroish.bg"
  type     = "MX"
  content  = "${each.key}.mx.cloudflare.net"
  priority = each.value
  ttl      = 1
  comment  = "Cloudflare Email Sending bounce mail"
}
