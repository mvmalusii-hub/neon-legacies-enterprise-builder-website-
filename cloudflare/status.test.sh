#!/usr/bin/env bash
# ============================================================
#  Offline tests for cloudflare/status.sh
#  ------------------------------------------------------------
#  Stubs the three network touch-points (curl for DoH, WHOIS,
#  direct nameserver probes) so the verdict logic is exercised
#  without any network access:
#
#    ./cloudflare/status.test.sh
#
#  Scenarios:
#    pending  registrar untouched, Cloudflare zone already empty
#    mixed    the real 2026-11-01 state: registry lists FOUR
#             nameservers (two Cloudflare + two Domains.co.za)
#    live     delegation switched, records present, DNSSEC done
# ============================================================
set -u

HERE=$(cd "$(dirname "$0")" && pwd)
SCRIPT="$HERE/status.sh"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"

# ---------------------------------------------------------------- curl
cat > "$TMP/bin/curl" <<'FAKE_CURL'
#!/usr/bin/env bash
args="$*"
name=$(printf '%s' "$args" | sed -n 's/.*[?&]name=\([^&]*\).*/\1/p')
type=$(printf '%s' "$args" | sed -n 's/.*[?&]type=\([A-Z]*\).*/\1/p')
answer() { printf '{"Status":0,"Answer":[%s]}' "$1"; }
rr()     { printf '{"name":"%s","type":%s,"TTL":%s,"data":"%s"}' "$1" "$2" "$3" "$4"; }

if printf '%s' "$args" | grep -q -- '-sI'; then
  case "${SCENARIO:-}:$args" in
    live:*neonlegacies.co.za*)       printf 'HTTP/2 200\r\nserver: cloudflare\r\n\r\n' ;;
    *:https://neonlegacies.co.za/*)  printf '' ;;
    *) printf 'HTTP/2 200\r\nserver: GitHub.com\r\n\r\n' ;;
  esac
  exit 0
fi

case "${SCENARIO:-}:$name:$type" in
  pending:neonlegacies.co.za:NS|mixed:neonlegacies.co.za:NS)
    a=$(rr neonlegacies.co.za 2 19747 ns1.anycast-ns.com.)
    b=$(rr neonlegacies.co.za 2 19747 ns2.anycast-ns.net.)
    c=$(rr neonlegacies.co.za 2 19747 ns3.anycast-ns.com.)
    d=$(rr neonlegacies.co.za 2 19747 ns4.anycast-ns.net.)
    answer "$a,$b,$c,$d" ;;
  live:neonlegacies.co.za:NS)
    a=$(rr neonlegacies.co.za 2 21600 emma.ns.cloudflare.com.)
    b=$(rr neonlegacies.co.za 2 21600 norm.ns.cloudflare.com.)
    answer "$a,$b" ;;
  live:neonlegacies.co.za:DS) answer "$(rr neonlegacies.co.za 43 3600 '2371 13 2 ABCD')" ;;
  *:neonlegacies.co.za:DS)    answer "" ;;
  *:emma.ns.cloudflare.com:A) answer "$(rr emma.ns.cloudflare.com 1 300 108.162.192.112)" ;;
  *)
    if [ "${SCENARIO:-}" = "live" ]; then
      printf '{"Status":0,"AD":true,"Answer":[]}'
    else
      answer ""
    fi ;;
esac
exit 0
FAKE_CURL

# --------------------------------------------------------------- whois
cat > "$TMP/bin/whois" <<'FAKE_WHOIS'
#!/usr/bin/env bash
domain="$1"
echo "Domain Name: $domain"
echo "Updated Date: 2026-11-01T00:18:48Z"
case "${SCENARIO:-}" in
  pending)
    echo "Name Server: ns1.anycast-ns.com"
    echo "Name Server: ns2.anycast-ns.net"
    echo "Name Server: ns3.anycast-ns.com"
    echo "Name Server: ns4.anycast-ns.net"
    echo "DNSSEC: unsigned" ;;
  mixed)
    echo "Name Server: emma.ns.cloudflare.com"
    echo "Name Server: norm.ns.cloudflare.com"
    echo "Name Server: ns3.anycast-ns.com"
    echo "Name Server: ns4.anycast-ns.net"
    echo "DNSSEC: unsigned" ;;
  live)
    echo "Name Server: emma.ns.cloudflare.com"
    echo "Name Server: norm.ns.cloudflare.com"
    echo "DNSSEC: signed" ;;
esac
exit 0
FAKE_WHOIS

# --------------------------------------------------------------- probe
cat > "$TMP/bin/probe" <<'FAKE_PROBE'
#!/usr/bin/env bash
# probe <server-ip> <type> <name>
type="$2"
name="$3"
case "${SCENARIO:-}:$type" in
  live:SOA|pending:SOA|mixed:SOA)
    echo "emma.ns.cloudflare.com dns.cloudflare.com serial=2418977566" ;;
  live:CNAME)
    case "$name" in www.*) echo "mvmalusii-hub.github.io" ;; esac ;;
  live:A)
    case "$name" in www.*) ;; *) printf '185.199.108.153\n185.199.109.153\n' ;; esac ;;
esac
exit 0
FAKE_PROBE

chmod +x "$TMP/bin/curl" "$TMP/bin/whois" "$TMP/bin/probe"

PASS=0
FAIL=0
ok()  { printf '\033[32m  ok   %s\033[0m\n' "$1"; PASS=$((PASS + 1)); }
bad() { printf '\033[31m  FAIL %s\033[0m\n' "$1"; FAIL=$((FAIL + 1)); }

# expect <scenario> <exit code> <text the output must contain> <label>
expect() {
  local scenario="$1" want="$2" needle="$3" label="$4" out code
  out=$(PATH="$TMP/bin:$PATH" SCENARIO="$scenario" \
        WHOIS_CMD="$TMP/bin/whois" PROBE_CMD="$TMP/bin/probe" \
        bash "$SCRIPT" neonlegacies.co.za 2>&1)
  code=$?
  if [ "$code" != "$want" ]; then
    bad "$label (exit $code, wanted $want)"
    printf '%s\n' "$out" | sed 's/^/         /'
  elif ! printf '%s' "$out" | grep -qF -- "$needle"; then
    bad "$label (missing: $needle)"
    printf '%s\n' "$out" | sed 's/^/         /'
  else
    ok "$label"
  fi
}

echo "cloudflare/status.sh – offline tests"
echo
expect pending 1 "the Domains.co.za change has not reached ZARC" "pending: registrar change not visible at ZARC"
expect pending 1 "the zone has NO www record"                   "pending: empty Cloudflare zone is called out"
expect pending 1 "is still served by GitHub.com"                "pending: traffic still reaches GitHub"
expect pending 1 "DNSSEC is NOT enabled"                             "pending: DNSSEC is reported as missing"

expect mixed 1 "PARTIAL change"                                  "mixed: partial registrar change is detected"
expect mixed 1 "the old nameservers were added to, not replaced"  "mixed: user is told to remove them"
expect mixed 1 "the zone has NO www record"                      "mixed: empty zone is still reported"

expect live 0 "all"                                                          "live: verdict is clean (exit 0)"
expect live 0 "the registry publishes exactly the two Cloudflare nameservers" "live: registry check passes"
expect live 0 "www exists in the zone"                                       "live: zone contents are verified"
expect live 0 "is served by Cloudflare"                                      "live: traffic goes through Cloudflare"
expect live 0 "DNSSEC is live"                                                "live: DS validates end to end"

echo
if [ "$FAIL" -eq 0 ]; then
  printf '\033[32m%s/%s checks passed\033[0m\n' "$PASS" "$((PASS + FAIL))"
  exit 0
fi
printf '\033[31m%s check(s) failed\033[0m\n' "$FAIL"
exit 1
