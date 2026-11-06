#!/usr/bin/env bash
# ============================================================
#  Install the agent workflows into .github/workflows/
#  ------------------------------------------------------------
#  GitHub only runs workflows from .github/workflows/, and the
#  automation token used while building this layer is not allowed
#  to write that path. Run this once with your own credentials:
#
#      ./neon_agents/install-workflows.sh            # copy, then show git steps
#      ./neon_agents/install-workflows.sh --commit   # copy and commit (no push)
#
#  It is idempotent: running it again just reports "already current".
# ============================================================
set -u

cd "$(dirname "$0")/.." || exit 1

SRC="neon_agents/workflows"
DST=".github/workflows"
COMMIT=0
[ "${1:-}" = "--commit" ] && COMMIT=1

[ -d "$SRC" ] || { echo "$SRC not found – run from the repository root" >&2; exit 2; }
mkdir -p "$DST"

changed=0
for file in "$SRC"/*.yml; do
  name=$(basename "$file")
  if [ -f "$DST/$name" ] && cmp -s "$file" "$DST/$name"; then
    echo "  ok      $DST/$name (already current)"
    continue
  fi
  cp "$file" "$DST/$name"
  echo "  copied  $file -> $DST/$name"
  changed=$((changed + 1))
done

echo
if [ "$changed" -eq 0 ]; then
  echo "Nothing to do: all workflows are installed."
  exit 0
fi

echo "Installed $changed workflow file(s)."
if [ "$COMMIT" -eq 1 ]; then
  git add "$DST"
  git -c user.name="$(git config user.name || echo neon-agents)" \
      -c user.email="$(git config user.email || echo neon-agents@localhost)" \
      commit -m "Add agent workflows (agent-tests, onboard, legis)"
  echo "Committed. Push with: git push"
else
  echo "Next:"
  echo "  git add $DST && git commit -m 'Add agent workflows' && git push"
fi
echo
echo "Secrets the live workflows need (Settings > Secrets and variables > Actions):"
echo "  DEEPSEEK_API_KEY  and/or  QWEN_API_KEY"
echo "agent-tests.yml needs none and will pass immediately."
