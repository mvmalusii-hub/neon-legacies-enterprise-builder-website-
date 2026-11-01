#!/usr/bin/env bash
# ============================================================
#  Neon Legacies – Cloudflare migration status
#  ------------------------------------------------------------
#  Answers the only question that matters while the dashboard is
#  still showing "Cloudflare Nameservers" + "DNSSEC pending":
#  *does the rest of the internet already see Cloudflare?*
#
#  The dashboard reflects the ZONE, not the DELEGATION. A zone can
#  sit in "Pending Nameserver Update" for a day while the registrar
#  still publishes the old nameservers. This script reads the DNS
#  the way a visitor's resolver does, so it cannot be fooled by a
#  dashboard cache.
#
#  No `dig` needed – it uses DNS-over-HTTPS (dns.google +
#  cloudflare-dns.com) through curl, which every runner has.
#
#    ./cloudflare/status.sh                      # neonlegacies.co.za
#    ./cloudflare/status.sh example.co.za
#
#  Set CLOUDFLARE_NS="ns1 ns2" to override the expected nameservers
#  (Cloudflare ▸ your zone ▸ Overview shows the pair it assigned).
# ============================================================
set -u

DOMAIN="${1:-neonlegacies.co.za}"
WWW="www.$DOMAIN"
CLOUDFLARE_NS="${CLOUDFLARE_NS:-emma.ns.cloudflare.com norm.ns.cloudflare.com}"
SITE="https://$WWW"

PASS=0
FAIL=0
NOTE=0

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
amber() { printf '\033[33m%s\033[0m\n' "$1"; }

pass() { green "  PASS  $1"; PASS=$((PASS + 1)); }
fail() { red   "  FAIL  $1"; FAIL=$((FAIL + 1)); }
note() { amber "  NOTE  $1"; NOTE=$((NOTE + 1)); }

# doh <resolver> <name> <type> -> one record value per line, no trailing dot
# Only the ANSWER section is used, so an empty answer never "falls back" to
# the SOA record the resolver puts in the authority section.
doh() {
  local resolver="$1" name="$2" type="$3" endpoint
  case "$resolver" in
    google)      endpoint="https://dns.google/resolve" ;;
    cloudflare)  endpoint="https://cloudflare-dns.com/dns-query" ;;
    *)           endpoint="$resolver" ;;
  esac
  curl -sS --max-time 20 -H 'accept: application/dns-json' \
    "$endpoint?name=$name&type=$type" 2>/dev/null \
    | node -e '
        let body = "";
        process.stdin.on("data", d => { body += d; });
        process.stdin.on("end", () => {
          const codes = { A: 1, NS: 2, CNAME: 5, AAAA: 28, DS: 43 };
          let json;
          try { json = JSON.parse(body); } catch (err) { return; }
          (json.Answer || [])
            .filter(a => a.type === codes[process.argv[1]])
            .forEach(a => console.log(String(a.data).replace(/\.$/, "")));
        });
      ' "$type" \
    || true
}

# join the lines of stdin with ", ", or print <none> when there is nothing
join_lines() {
  local joined
  joined=$(paste -sd, - 2>/dev/null | sed 's/,/, /g')
  if [ -n "${joined:-}" ]; then printf '%s\n' "$joined"; else printf '<none>\n'; fi
}

http_server() {
  curl -sI --max-time 20 "$1" 2>/dev/null \
    | tr -d '\r' \
    | grep -i '^server:' \
    | head -n 1 \
    | sed 's/^[Ss]erver: *//' \
    || true
}

echo "Cloudflare status for $DOMAIN"
echo "Expected Cloudflare nameservers: $CLOUDFLARE_NS"
echo

# ---------------------------------------------------------------- 1. NS
g_ns=$(doh google "$DOMAIN" NS | sort)
c_ns=$(doh cloudflare "$DOMAIN" NS | sort)

echo "1. Delegation (the nameservers the registrar publishes)"
echo "   dns.google:      $(printf '%s\n' "$g_ns" | join_lines)"
echo "   cloudflare-dns:  $(printf '%s\n' "$c_ns" | join_lines)"

expected_missing=0
for ns in $CLOUDFLARE_NS; do
  printf '%s\n' "$g_ns" | grep -qx "$ns" || expected_missing=$((expected_missing + 1))
  printf '%s\n' "$c_ns" | grep -qx "$ns" || expected_missing=$((expected_missing + 1))
done
ns_live=0
if [ -z "$g_ns" ] || [ -z "$c_ns" ]; then
  fail "no nameservers returned – the domain is not resolving at all"
elif [ "$expected_missing" -eq 0 ]; then
  ns_live=1
  pass "both resolvers see the Cloudflare nameservers – delegation is live"
else
  fail "the registrar still publishes old nameservers – change them at Domains.co.za (see README step 0b)"
fi
echo

# --------------------------------------------------------------- 2. DS
g_ds=$(doh google "$DOMAIN" DS)
c_ds=$(doh cloudflare "$DOMAIN" DS)

echo "2. DNSSEC (DS record in the .co.za zone)"
echo "   dns.google:      $(printf '%s\n' "$g_ds" | join_lines)"
echo "   cloudflare-dns:  $(printf '%s\n' "$c_ds" | join_lines)"

if [ -n "$g_ds" ] || [ -n "$c_ds" ]; then
  if [ "$ns_live" -eq 1 ]; then
    pass "DS is published and Cloudflare answers authoritatively – DNSSEC is complete"
  else
    fail "DS is published while the old nameservers still answer: signed parents + unsigned answers = SERVFAIL
         Remove the DS at Domains.co.za right now, finish the nameserver change, then re-add it."
  fi
else
  note "no DS record yet – correct while the nameservers are still at Domains.co.za.
         Add the DS from Cloudflare ▸ DNS ▸ Settings ▸ DNSSEC only AFTER step 1 is live."
fi
echo

# --------------------------------------------------------- 3. www + apex
echo "3. Traffic path"
server_www=$(http_server "$SITE/")
if [ "$server_www" = "cloudflare" ]; then
  pass "$WWW is served by Cloudflare (server: cloudflare)"
elif [ -n "$server_www" ]; then
  fail "$WWW is still served by $server_www – traffic is not going through Cloudflare yet"
else
  fail "$WWW did not answer at all"
fi

apex_a=$(doh google "$DOMAIN" A)
www_cname=$(doh google "$WWW" CNAME)
echo "   $WWW CNAME: $(printf '%s\n' "$www_cname" | join_lines)"
echo "   $DOMAIN A:  $(printf '%s\n' "$apex_a" | join_lines)"
if [ -n "$apex_a" ]; then
  pass "the apex resolves"
else
  note "the apex has no A records – add the four GitHub Pages A records in Cloudflare (§1) so the bare domain stops timing out"
fi
echo

# ------------------------------------------------------------- verdict
echo "----------------------------------------"
if [ "$FAIL" -eq 0 ]; then
  if [ "$NOTE" -eq 0 ]; then
    green "all $PASS checks passed – Cloudflare owns the zone and serves the site."
  else
    green "$PASS passed, $NOTE waiting – nothing is broken; finish the steps marked NOTE."
  fi
  exit 0
fi
red "$FAIL check(s) failed, $PASS passed, $NOTE waiting."
echo "Runbook: cloudflare/README.md – step 0b is the screen in the screenshot."
exit 1
