# The records already exist. The first apply with a DNS token adopts them
# instead of creating a second copy.

import {
  to = cloudflare_dns_record.sending_spf
  id = "0c635b10986f6bd823012916013882ef/3a9683c8851f23448dc97aee8e190be9"
}

import {
  to = cloudflare_dns_record.sending_mx["route1"]
  id = "0c635b10986f6bd823012916013882ef/7ede95f34c9096fdcbaf2afb7c1a3c5c"
}

import {
  to = cloudflare_dns_record.sending_mx["route2"]
  id = "0c635b10986f6bd823012916013882ef/40c6d29b4879625cac90dc0b62f87ff9"
}

import {
  to = cloudflare_dns_record.sending_mx["route3"]
  id = "0c635b10986f6bd823012916013882ef/b94e45ab0ed2a6bd9f50fc2e6391685a"
}
