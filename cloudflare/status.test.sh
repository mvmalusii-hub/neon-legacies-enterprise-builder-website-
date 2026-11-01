#!/usr/bin/env bash
# ============================================================
#  Offline tests for cloudflare/status.sh
#  ------------------------------------------------------------
#  Stubs `curl` so the verdict logic is exercised without any
#  network access:
#
#    ./cloudflare/status.test.sh
#
#  Scenario A ("pending") is the dashboard in the screenshot:
#  zone added in Cloudflare, registrar still on Domains.co.za.
#  Scenario B ("live") is the state after the nameservers and
#  the DS record have been switched over.
# ============================================================
set -u

HERE=$(cd "$(dirname "$0")" && pwd)
SCRIPT="$HERE/status.sh"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/bin"

cat > "$TMP/bin/curl" <<'FAKE_CURL'
#!/usr/bin/env bash
# Minimal `curl` stand-in: serves canned DoH JSON and HEAD headers.
args="$*"

if printf '%s' "$args" | grep -q -- '-sI'; then
  if [ "${SCENARIO:-}" = "live" ]; then
    printf 'HTTP/2 200\r\nserver: cloudflare\r\n\r\n'
  else
    printf 'HTTP/2 200\r\nserver: GitHub.com\r\n\r\n'
  fi
  exit 0
fi

name=$(printf '%s' "$args" | sed -n 's/.*[?&]name=\([^&]*\).*/\1/p')
type=$(printf '%s' "$args" | sed -n 's/.*[?&]type=\([A-Z]*\).*/\1/p')

answer() { printf '{"Status":0,"Answer":[%s]}' "$1"; }
rr()     { printf '{"name":"%s","type":%s,"TTL":300,"data":"%s"}' "$1" "$2" "$3"; }

case "${SCENARIO:-}:$name:$type" in
  pending:neonlegacies.co.za:NS)
    ns1=$(rr neonlegacies.co.za 2 ns1.anycast-ns.com.)
    ns2=$(rr neonlegacies.co.za 2 ns2.anycast-ns.net.)
    ns3=$(rr neonlegacies.co.za 2 ns3.anycast-ns.com.)
    ns4=$(rr neonlegacies.co.za 2 ns4.anycast-ns.net.)
    answer "$ns1,$ns2,$ns3,$ns4"
    ;;
  live:neonlegacies.co.za:NS)
    ns1=$(rr neonlegacies.co.za 2 emma.ns.cloudflare.com.)
    ns2=$(rr neonlegacies.co.za 2 norm.ns.cloudflare.com.)
    answer "$ns1,$ns2"
    ;;
  pending:neonlegacies.co.za:DS) answer "" ;;
  live:neonlegacies.co.za:DS)    answer "$(rr neonlegacies.co.za 43 '2371 13 2 0123456789ABCDEF')" ;;
  pending:neonlegacies.co.za:A)  answer "" ;;
  live:neonlegacies.co.za:A)
    a1=$(rr neonlegacies.co.za 1 185.199.108.153)
    a2=$(rr neonlegacies.co.za 1 185.199.109.153)
    a3=$(rr neonlegacies.co.za 1 185.199.110.153)
    a4=$(rr neonlegacies.co.za 1 185.199.111.153)
    answer "$a1,$a2,$a3,$a4"
    ;;
  *:www.neonlegacies.co.za:CNAME) answer "$(rr www.neonlegacies.co.za 5 mvmalusii-hub.github.io.)" ;;
  *) answer "" ;;
esac
exit 0
FAKE_CURL

chmod +x "$TMP/bin/curl"

PASS=0
FAIL=0
passed() { printf '\033[32m  ok   %s\033[0m\n' "$1"; PASS=$((PASS + 1)); }
failed() { printf '\033[31m  FAIL %s\033[0m\n' "$1"; FAIL=$((FAIL + 1)); }

# expect <scenario> <exit code> <substring the output must contain> <label>
expect() {
  local scenario="$1" want_code="$2" needle="$3" label="$4" out code
  out=$(PATH="$TMP/bin:$PATH" SCENARIO="$scenario" bash "$SCRIPT" neonlegacies.co.za 2>&1)
  code=$?
  if [ "$code" != "$want_code" ]; then
    failed "$label (exit $code, wanted $want_code)"
    printf '%s\n' "$out" | sed 's/^/         /'
  elif ! printf '%s' "$out" | grep -qF -- "$needle"; then
    failed "$label (missing: $needle)"
    printf '%s\n' "$out" | sed 's/^/         /'
  else
    passed "$label"
  fi
}

echo "cloudflare/status.sh – offline tests"
echo
expect pending 1 "registrar still publishes old nameservers"  "pending: delegation is diagnosed"
expect pending 1 "no DS record yet"                           "pending: DNSSEC is correctly left off"
expect pending 1 "is still served by GitHub.com"              "pending: traffic still reaches GitHub"
expect pending 1 "the apex has no A records"                  "pending: missing apex records are reported"

expect live 0 "both resolvers see the Cloudflare nameservers" "live: delegation passes"
expect live 0 "DNSSEC is complete"                            "live: DS + Cloudflare authority agree"
expect live 0 "is served by Cloudflare"                       "live: traffic goes through Cloudflare"
expect live 0 "the apex resolves"                             "live: apex answers"

echo
if [ "$FAIL" -eq 0 ]; then
  printf '\033[32m%s/%s checks passed\033[0m\n' "$PASS" "$((PASS + FAIL))"
  exit 0
fi
printf '\033[31m%s check(s) failed\033[0m\n' "$FAIL"
exit 1
