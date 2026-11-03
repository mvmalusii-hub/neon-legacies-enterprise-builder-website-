#!/usr/bin/env bash
# ============================================================
#  Neon Legacies – deploy the security-headers Worker
#  ------------------------------------------------------------
#  GitHub Pages cannot send response headers, so this Worker is
#  what adds CSP / HSTS / nosniff / Referrer-Policy / COOP to
#  every page. Without it the login page ships no CSP at all
#  (see cloudflare/README.md §3).
#
#    CLOUDFLARE_API_TOKEN=... ./cloudflare/deploy.sh
#
#  The token needs the "Workers Scripts: Edit" permission and
#  access to the neonlegacies.co.za zone. Create one at
#  https://dash.cloudflare.com/profile/api-tokens
#
#  Prove it afterwards with:  ./cloudflare/verify.sh
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN (Workers Scripts:Edit) before running}"

echo "Deploying neon-legacies-security-headers to www.neonlegacies.co.za/* ..."
npx --yes wrangler@latest deploy

echo
echo "Done. Now run ./cloudflare/verify.sh – the 7 header checks must pass."
