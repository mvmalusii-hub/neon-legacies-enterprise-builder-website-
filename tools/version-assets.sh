#!/usr/bin/env bash
# ============================================================
#  Neon Legacies – version the login script
#  ------------------------------------------------------------
#  GitHub Pages sends `cache-control: max-age=14400` for auth.js,
#  and Cloudflare's cache rule only stops the EDGE from serving a
#  stale copy. A visitor's own browser still keeps it for 4 hours,
#  so a sign-in fix can be correct on the server and invisible in
#  the browser.
#
#  A content-hash query string fixes that: every page asks for
#  auth.js?v=<first 10 chars of its sha256>. Change the file and
#  the URL changes, so nothing stale can be reused anywhere.
#
#    ./tools/version-assets.sh           # rewrite the pages
#    ./tools/version-assets.sh --check   # fail if a page is behind
#
#  Run it (or --check) after every edit to auth.js, before pushing.
# ============================================================
set -u

cd "$(dirname "$0")/.." || exit 1

ASSET="auth.js"
CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

[ -f "$ASSET" ] || { echo "auth.js not found – run from the repo root" >&2; exit 2; }

HASH=$(sha256sum "$ASSET" | cut -c1-10)
WANT="src=\"$ASSET?v=$HASH\""

files=$(grep -rl --include='*.html' "src=\"$ASSET" . | sort)
if [ -z "$files" ]; then
  echo "no HTML page references $ASSET" >&2
  exit 2
fi

if [ "$CHECK" -eq 1 ]; then
  stale=""
  for f in $files; do
    grep -qF -- "$WANT" "$f" || stale="$stale $f"
  done
  if [ -n "$stale" ]; then
    echo "auth.js is versioned as ?v=$HASH but these pages are behind:$stale" >&2
    echo "Run ./tools/version-assets.sh" >&2
    exit 1
  fi
  echo "auth.js?v=$HASH is referenced by $(printf '%s\n' "$files" | wc -l | tr -d ' ') pages"
  exit 0
fi

for f in $files; do
  sed -i -E "s|src=\"$ASSET(\?v=[0-9a-f]+)?\"|$WANT|g" "$f"
done

echo "auth.js hashed as ?v=$HASH in $(printf '%s\n' "$files" | wc -l | tr -d ' ') pages"
