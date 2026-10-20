# These were created with the Cloudflare CLI on 2026-10-20 (Da Bulgaria account),
# before any token for this root existed. The first apply adopts them instead of
# creating second copies. The zone had no origin or configuration rules before.

import {
  to = cloudflare_dns_record.minio_origin
  id = "0c635b10986f6bd823012916013882ef/9b9159e1503713e507fcff3fb10bcea2"
}

import {
  to = cloudflare_ruleset.origin
  id = "zones/0c635b10986f6bd823012916013882ef/e5d2c074e231428e8fdfc4c11282da3e"
}

import {
  to = cloudflare_ruleset.config
  id = "zones/0c635b10986f6bd823012916013882ef/8eec77e875eb4710a0fd1643c40ca002"
}
