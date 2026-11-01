#!/usr/bin/env bash
# ============================================================
#  Neon Legacies – live login-security check
#  ------------------------------------------------------------
#  Confirms, against the REAL site, that Cloudflare is in front
#  and that the headers the Google sign-in depends on are being
#  sent. Run it before and after each Cloudflare step.
#
#    ./cloudflare/verify.sh                       # production
#    ./cloudflare/verify.sh http://localhost:8000 # local (headers will fail)
# ============================================================
set -u

SITE="${1:-https://www.neonlegacies.co.za}"
PASS=0
FAIL=0

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }

# check "<description>" "<expected substring>" "<url>"
check_header() {
  local label="$1" needle="$2" url="$3" headers
  headers=$(curl -sSI --max-time 20 "$url" 2>/dev/null | tr -d '\r')
  if printf '%s' "$headers" | grep -qi -- "$needle"; then
    green "  PASS  $label"
    PASS=$((PASS + 1))
  else
    red   "  FAIL  $label"
    FAIL=$((FAIL + 1))
  fi
}

check_code() {
  local label="$1" expected="$2" url="$3" code
  code=$(curl -sS -o /dev/null --max-time 20 -w '%{http_code}' "$url" 2>/dev/null)
  if [ "$code" = "$expected" ]; then
    green "  PASS  $label (HTTP $code)"
    PASS=$((PASS + 1))
  else
    red   "  FAIL  $label (HTTP $code, wanted $expected)"
    FAIL=$((FAIL + 1))
  fi
}

# auth.js is the login logic. If the edge caches it, a fix takes hours to reach
# users and sign-in bugs look "random". Cache rule 4.1 must bypass it.
check_auth_js_cache() {
  local headers cache_status cache_control
  headers=$(curl -sSI --max-time 20 "$SITE/auth.js" 2>/dev/null | tr -d '\r')
  cache_status=$(printf '%s\n' "$headers" | grep -i '^cf-cache-status:' | head -n 1 | awk '{print tolower($2)}')
  cache_control=$(printf '%s\n' "$headers" | grep -i '^cache-control:' | head -n 1 | sed 's/^[Cc]ache-[Cc]ontrol: *//')

  case "$cache_status" in
    bypass|dynamic)
      green "  PASS  auth.js is not edge-cached (cf-cache-status: $cache_status)"
      PASS=$((PASS + 1)) ;;
    *)
      if printf '%s' "$cache_control" | grep -qiE 'no-store|no-cache|max-age=0'; then
        green "  PASS  auth.js is not edge-cached (cache-control: $cache_control)"
        PASS=$((PASS + 1))
      else
        red   "  FAIL  auth.js is edge-cached (cf-cache-status: ${cache_status:-none}, cache-control: ${cache_control:-none})"
        red   "        Add cache rule 4.1: uri.path eq \"/auth.js\" -> Bypass cache"
        FAIL=$((FAIL + 1))
      fi ;;
  esac
}

echo "Checking $SITE"
echo
echo "Cloudflare in front of the site"
check_header "server is Cloudflare" "server: cloudflare" "$SITE/profile.html"

echo
echo "Security headers on the login page"
check_header "Content-Security-Policy" "content-security-policy:" "$SITE/profile.html"
check_header "  …allows accounts.google.com (Google button)" "content-security-policy:.*accounts\.google\.com" "$SITE/profile.html"
check_header "  …allows script.google.com (session check)" "content-security-policy:.*script\.google\.com" "$SITE/profile.html"
check_header "HSTS" "strict-transport-security:" "$SITE/profile.html"
check_header "X-Content-Type-Options: nosniff" "x-content-type-options: *nosniff" "$SITE/profile.html"
check_header "Referrer-Policy" "referrer-policy:" "$SITE/profile.html"
check_header "COOP allows Google's popup" "cross-origin-opener-policy: *same-origin-allow-popups" "$SITE/profile.html"

echo
echo "Repo internals hidden"
check_code "  /.git/config blocked" "404" "$SITE/.git/config"
check_code "  /.env blocked" "404" "$SITE/.env"
check_code "  test sources blocked" "404" "$SITE/apps-script/test/google-auth.test.js"

echo
echo "Login assets reachable"
check_code "profile.html" "200" "$SITE/profile.html"
check_code "auth.js" "200" "$SITE/auth.js"

echo
echo "Login assets are never stale"
check_auth_js_cache

echo
echo "----------------------------------------"
if [ "$FAIL" -eq 0 ]; then
  green "$PASS checks passed – Cloudflare and the login headers are live."
  exit 0
fi
red "$FAIL check(s) failed, $PASS passed."
echo "Runbook: cloudflare/README.md (steps 1–5), then run this again."
exit 1
