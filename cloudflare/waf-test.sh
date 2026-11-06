#!/usr/bin/env bash
# ============================================================
#  Neon Legacies – are the Cloudflare protections actually on?
#  ------------------------------------------------------------
#  Each check talks to the LIVE site and decides from the response
#  whether the corresponding dashboard rule exists. When one fails
#  the message names the exact rule to create.
#
#    ./cloudflare/waf-test.sh                # all checks
#    ./cloudflare/waf-test.sh --no-ratelimit # skip the 40-request burst
#
#  The rate-limit check fires 40 requests at /profile.html on purpose:
#  that is the only way to prove a rate-limit rule exists. It runs last
#  and may leave your IP blocked for the rule's duration (1 minute).
# ============================================================
set -u

SITE="${SITE:-https://www.neonlegacies.co.za}"
RATE_REQUESTS="${RATE_REQUESTS:-40}"
DO_RATELIMIT=1
for arg in "$@"; do
  case "$arg" in
    --no-ratelimit) DO_RATELIMIT=0 ;;
  esac
done

PASS=0
FAIL=0
NOTE=0
green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
amber() { printf '\033[33m%s\033[0m\n' "$1"; }
pass() { green "  PASS  $1"; PASS=$((PASS + 1)); }
fail() { red   "  FAIL  $1"; FAIL=$((FAIL + 1)); }
note() { amber "  NOTE  $1"; NOTE=$((NOTE + 1)); }

code_of() { curl -s -o /dev/null --max-time 20 -w '%{http_code}' "$@" 2>/dev/null; }

header_of() { # header_of <header-name> <url>
  curl -sI --max-time 20 "$2" 2>/dev/null | tr -d '\r' \
    | grep -i "^$1:" | head -n 1 | sed 's/^[^:]*: *//'
}

echo "Cloudflare protections on $SITE"
echo

# ------------------------------------------- 1. stale login code (cache)
echo "1. auth.js is never served stale (§4 rule 1)"
cc=$(header_of 'cache-control' "$SITE/auth.js")
cs=$(header_of 'cf-cache-status' "$SITE/auth.js")
cs=$(printf '%s' "$cs" | tr '[:upper:]' '[:lower:]')
if [ "$cs" = "bypass" ] || [ "$cs" = "dynamic" ] \
   || printf '%s' "$cc" | grep -qiE 'no-store|no-cache|max-age=0'; then
  pass "auth.js is not cached at the edge (cf-cache-status: ${cs:-none}, cache-control: ${cc:-none})"
else
  fail "auth.js is edge-cached (cf-cache-status: ${cs:-none}, cache-control: ${cc:-none})
         Add Caching > Cache Rules: uri.path eq \"/auth.js\" -> Bypass cache"
fi
echo

# --------------------------------------------- 2. writes are refused
echo "2. nothing can POST to the site (§5 WAF rule 1)"
post_code=$(code_of -X POST -d 'probe=1' "$SITE/")
case "$post_code" in
  403|429)
    pass "POST is blocked at the edge (HTTP $post_code)" ;;
  405|501|200)
    fail "POST reached the origin (HTTP $post_code)
         Add Security > WAF > Custom rules: http.request.method in {\"POST\" \"PUT\" \"PATCH\" \"DELETE\"} -> Block" ;;
  *)
    note "POST answered HTTP $post_code – check the WAF rule manually" ;;
esac
echo

# ------------------------------------------- 3. repo internals are hidden
echo "3. repo internals are not downloadable (§5 WAF rules + _config.yml exclude)"
blocked() { # blocked <path> <label>
  local path="$1" label="$2" code
  # cache-buster: a stale edge copy of a now-404 file must not look like a leak
  code=$(code_of "$SITE$path?nl_probe=$RANDOM$RANDOM")
  case "$code" in
    403|404) pass "$label (HTTP $code)" ;;
    *)       fail "$label is public (HTTP $code) – add it to _config.yml exclude or the WAF rule from §5" ;;
  esac
}
blocked "/apps-script/Auth.gs" "login backend source"
blocked "/apps-script/Code.gs" "leads backend source"
blocked "/apps-script/test/google-auth.test.js" "auth tests"
blocked "/apps-script/test/cloudflare-worker.test.js" "worker tests"
blocked "/cloudflare/security-headers.worker.js" "Worker source"
blocked "/config.yml" "Jekyll config"
blocked "/neon_agents/agents/onboard_prompt.txt" "agent prompt"
blocked "/neon_agents/agents/onboard_schema.json" "agent schema"
blocked "/neon_agents/provider.py" "agent provider code"
blocked "/.htaccess" ".htaccess"
blocked "/.env" ".env"
blocked "/.git/config" ".git/config"
echo

# ------------------------------------------------ 4. bot mitigation
echo "4. automated clients are challenged (§5 Bot Fight Mode)"
bot_headers=$(curl -sI --max-time 20 -A 'python-requests/2.31.0' "$SITE/profile.html" 2>/dev/null | tr -d '\r')
bot_code=$(printf '%s\n' "$bot_headers" | head -n 1 | awk '{print $2}')
if printf '%s\n' "$bot_headers" | grep -qi '^cf-mitigated:' \
   || [ "$bot_code" = "403" ] || [ "$bot_code" = "429" ] || [ "$bot_code" = "503" ]; then
  pass "a scripted client is challenged (HTTP $bot_code${bot_headers:+})"
else
  note "a scripted client got HTTP $bot_code – Bot Fight Mode may be off.
         Security > Bots > Bot Fight Mode: On. (Heuristic, so a pass here is not proof
         either way; the WAF and rate-limit rules are the deterministic part.)"
fi
echo

# ------------------------------------------------- 5. rate limiting
echo "5. the login page is rate limited (§5 rate-limit rule)"
if [ "$DO_RATELIMIT" -eq 0 ]; then
  note "skipped (--no-ratelimit)"
else
  hit429=0
  i=1
  while [ "$i" -le "$RATE_REQUESTS" ]; do
    c=$(code_of -A "neon-ratelimit-probe/$i" "$SITE/profile.html")
    if [ "$c" = "429" ]; then hit429=$((hit429 + 1)); fi
    i=$((i + 1))
  done
  if [ "$hit429" -gt 0 ]; then
    pass "rate limiting is active ($hit429 of $RATE_REQUESTS requests returned 429)"
  else
    fail "no 429 in $RATE_REQUESTS requests
         Add Security > WAF > Rate limiting rules: path eq \"/profile.html\" or
         path eq \"/auth.js\", 30 requests / 1 minute per IP -> Block, duration 1 min, 429"
  fi
fi
echo

echo "----------------------------------------"
if [ "$FAIL" -eq 0 ]; then
  green "all $PASS protections verified${NOTE:+ ($NOTE note(s))}"
  exit 0
fi
red "$FAIL protection(s) missing, $PASS verified${NOTE:+, $NOTE note(s)}."
echo "Runbook: cloudflare/README.md §4 (cache) and §5 (WAF, bots, rate limit)."
exit 1
