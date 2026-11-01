#!/usr/bin/env bash
# ============================================================
#  Neon Legacies – Cloudflare migration status
#  ------------------------------------------------------------
#  Answers the only question that matters while the dashboard is
#  still showing "Cloudflare Nameservers" + "DNSSEC pending":
#  *does the rest of the internet already see Cloudflare?*
#
#  It checks four independent views, because they disagree:
#    1. the .co.za registry (authoritative, never cached)  <- the truth
#    2. public resolvers                                   <- what visitors get
#    3. the Cloudflare nameserver itself                   <- zone contents
#    4. the live site                                      <- who serves it
#
#  The registry check is the important one: a registrar can *add*
#  Cloudflare and leave the old nameservers in place, which shows up
#  as four nameservers and makes lookups randomly fail.
#
#  No `dig` needed – DNS-over-HTTPS via curl, WHOIS over TCP via node.
#
#    ./cloudflare/status.sh                      # neonlegacies.co.za
#    ./cloudflare/status.sh example.co.za
#
#  Overrides: CLOUDFLARE_NS="ns1 ns2" (the pair Cloudflare assigned),
#  WHOIS_CMD / PROBE_CMD (used by status.test.sh to run offline).
# ============================================================
set -u

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DOMAIN="${1:-neonlegacies.co.za}"
WWW="www.$DOMAIN"
CLOUDFLARE_NS="${CLOUDFLARE_NS:-emma.ns.cloudflare.com norm.ns.cloudflare.com}"
SITE="https://$WWW"
WHOIS_CMD="${WHOIS_CMD:-node $HERE/whois.js}"
PROBE_CMD="${PROBE_CMD:-node $HERE/dnsprobe.js}"

PASS=0
FAIL=0
NOTE=0

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
amber() { printf '\033[33m%s\033[0m\n' "$1"; }

pass() { green "  PASS  $1"; PASS=$((PASS + 1)); }
fail() { red   "  FAIL  $1"; FAIL=$((FAIL + 1)); }
note() { amber "  NOTE  $1"; NOTE=$((NOTE + 1)); }

# doh <resolver> <name> <type> -> one value per line, no trailing dot
# Only the ANSWER section is read, so an empty answer never "falls back" to
# the SOA record a resolver puts in the authority section.
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

# remaining cache time for the delegation, from the resolver's own TTL
doh_ttl() {
  curl -sS --max-time 20 -H 'accept: application/dns-json' \
    "https://dns.google/resolve?name=$1&type=NS" 2>/dev/null \
    | node -e '
        let body = "";
        process.stdin.on("data", d => { body += d; });
        process.stdin.on("end", () => {
          let json;
          try { json = JSON.parse(body); } catch (err) { return; }
          const ttls = (json.Answer || []).filter(a => a.type === 2).map(a => a.TTL);
          if (ttls.length) { console.log(Math.max.apply(null, ttls)); }
        });
      ' \
    || true
}

# join the lines of stdin with ", ", or print <none> when there is nothing
join_lines() {
  local joined
  joined=$(paste -sd, - 2>/dev/null | sed 's/,/, /g')
  if [ -n "${joined:-}" ]; then printf '%s\n' "$joined"; else printf '<none>\n'; fi
}

in_list() {
  local needle="$1" haystack
  haystack=" $(printf '%s' "$2" | tr '\n' ' ') "
  case "$haystack" in *" $needle "*) return 0 ;; *) return 1 ;; esac
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

# ------------------------------------------------ 1. registry (uncached)
whois_out=$($WHOIS_CMD "$DOMAIN" 2>/dev/null)
whois_ok=$?

registry_ns=""
registry_dnssec=""
registry_updated=""
if [ "$whois_ok" -eq 0 ] && [ -n "${whois_out:-}" ]; then
  registry_ns=$(printf '%s\n' "$whois_out" \
    | sed -n 's/^[Nn]ame [Ss]erver: *//p' \
    | tr '[:upper:]' '[:lower:]' \
    | sed 's/\.$//; s/[[:space:]]*$//' \
    | sed '/^$/d' | sort -u)
  registry_dnssec=$(printf '%s\n' "$whois_out" | sed -n 's/^[Dd][Nn][Ss][Ss][Ee][Cc]: *//p' | head -n 1)
  registry_updated=$(printf '%s\n' "$whois_out" | sed -n 's/^[Uu]pdated [Dd]ate: *//p' | head -n 1)
fi

registry_ok=0
echo "1. Registry delegation (.co.za, authoritative – cannot be cached)"
if [ "$whois_ok" -ne 0 ] || [ -z "${registry_ns:-}" ]; then
  note "could not read the registry WHOIS – the authoritative check is skipped"
else
  echo "   registry lists: $(printf '%s\n' "$registry_ns" | join_lines)"
  [ -n "${registry_updated:-}" ] && echo "   last updated:   $registry_updated"

  missing=""
  extras=""
  for ns in $CLOUDFLARE_NS; do
    in_list "$ns" "$registry_ns" || missing="$missing $ns"
  done
  for ns in $registry_ns; do
    in_list "$ns" "$CLOUDFLARE_NS" || extras="$extras $ns"
  done

  if [ -n "$missing" ]; then
    fail "the registry does not list${missing} yet – the Domains.co.za change has not reached ZARC"
  elif [ -n "$extras" ]; then
    fail "PARTIAL change: the registry lists ${extras# } as well – the old nameservers were added to, not replaced.
         Fix it at Domains.co.za: Nameservers -> leave only the two Cloudflare entries -> save.
         While both sets are published, every lookup is answered by whichever server the resolver picks."
  else
    registry_ok=1
    pass "the registry publishes exactly the two Cloudflare nameservers"
  fi
fi
echo

# --------------------------------------------------- 2. resolver view
g_ns=$(doh google "$DOMAIN" NS | sort)
c_ns=$(doh cloudflare "$DOMAIN" NS | sort)
stale_ttl=$(doh_ttl "$DOMAIN")

echo "2. Public resolvers (what visitors get – may be cached)"
echo "   dns.google:      $(printf '%s\n' "$g_ns" | join_lines)"
echo "   cloudflare-dns:  $(printf '%s\n' "$c_ns" | join_lines)"

resolver_cf=0
if [ -n "$g_ns" ] && [ -n "$c_ns" ] \
   && ! printf '%s\n%s\n' "$g_ns" "$c_ns" | grep -qv -E '\.ns\.cloudflare\.com$'; then
  resolver_cf=1
fi

if [ -z "$g_ns" ] || [ -z "$c_ns" ]; then
  fail "no nameservers returned – the domain is not resolving"
elif [ "$resolver_cf" -eq 1 ]; then
  pass "both resolvers already serve the Cloudflare nameservers"
elif [ "$registry_ok" -eq 1 ]; then
  note "caches still serve the old delegation${stale_ttl:+ (up to ${stale_ttl}s left)} – the registry is correct, so this clears itself"
else
  fail "resolvers still serve the old nameservers – consistent with the registry above"
fi
echo

# ----------------------------------------- 3. what Cloudflare itself says
echo "3. The Cloudflare zone (asked directly, no cache)"
cf_first=$(printf '%s\n' "$CLOUDFLARE_NS" | awk '{print $1}')
cf_ip=$(doh google "$cf_first" A | head -n 1)

zone_ok=0
if [ -z "${cf_ip:-}" ]; then
  note "could not resolve $cf_first – the zone check is skipped"
else
  echo "   asking $cf_first ($cf_ip)"
  soa=$($PROBE_CMD "$cf_ip" SOA "$DOMAIN" 2>/dev/null)
  www_answer=$($PROBE_CMD "$cf_ip" CNAME "$WWW" 2>/dev/null; $PROBE_CMD "$cf_ip" A "$WWW" 2>/dev/null)
  apex_answer=$($PROBE_CMD "$cf_ip" A "$DOMAIN" 2>/dev/null)

  if [ -z "${soa:-}" ]; then
    fail "Cloudflare does not answer for the zone – the zone is not loaded or not active"
  else
    zone_ok=1
    pass "Cloudflare is authoritative for the zone ($soa)"
    if [ -z "${www_answer:-}" ]; then
      fail "the zone has NO www record – a lookup that reaches Cloudflare returns NXDOMAIN.
         Add it now: CNAME www -> mvmalusii-hub.github.io (proxied)."
    else
      pass "www exists in the zone: $(printf '%s\n' "$www_answer" | join_lines)"
    fi
    if [ -z "${apex_answer:-}" ]; then
      note "no apex A records – add the four GitHub Pages A records (185.199.108-111.153) for the bare domain"
    else
      pass "the apex exists in the zone: $(printf '%s\n' "$apex_answer" | join_lines)"
    fi
  fi
fi
echo

# ----------------------------------------------------------- 4. DNSSEC
g_ds=$(doh google "$DOMAIN" DS)
c_ds=$(doh cloudflare "$DOMAIN" DS)

echo "4. DNSSEC"
echo "   DS seen by resolvers: $(printf '%s\n' "$g_ds" | join_lines)"
echo "   registry says:        ${registry_dnssec:-<unknown>}"

if [ -n "${g_ds:-}" ] || [ -n "${c_ds:-}" ]; then
  if [ "$registry_ok" -eq 1 ] && [ "$zone_ok" -eq 1 ]; then
    pass "DS is published and Cloudflare answers – DNSSEC is complete"
  else
    fail "a DS record exists but the delegation is not clean (see 1 and 3).
         Remove the DS at Domains.co.za until the nameservers are the only thing left to fix."
  fi
else
  note "no DS record yet – correct until sections 1 and 2 are green.
         Then: Cloudflare > DNS > Settings > DNSSEC, copy the DS into Domains.co.za."
fi
echo

# ------------------------------------------------------ 5. traffic path
echo "5. Traffic path"
server_www=$(http_server "$SITE/")
if [ "$server_www" = "cloudflare" ]; then
  pass "$WWW is served by Cloudflare (server: cloudflare)"
elif [ -n "$server_www" ]; then
  fail "$WWW is still served by $server_www – traffic is not going through Cloudflare yet"
else
  fail "$WWW did not answer at all"
fi

apex_head=$(curl -sI --max-time 20 "https://$DOMAIN/" 2>/dev/null | head -n 1 || true)
if [ -n "$apex_head" ]; then
  pass "the apex answers ($apex_head)"
else
  note "the apex does not answer over HTTPS yet – expected until the A records exist and the switch settles"
fi
echo

# ------------------------------------------------------------ verdict
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
