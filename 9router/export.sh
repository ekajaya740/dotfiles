#!/usr/bin/env bash
# Refresh 9router config backup into dotfiles and commit+push.
set -euo pipefail
cd "$(dirname "$0")/.."   # repo root
DOTFILES_REPO="$(pwd)"

echo "== exporting 9router config =="
python3 /tmp/export_9router.py 2>/dev/null || python3 "$DOTFILES_REPO/9router/export_9router.py"

echo "== secret scan (abort if any raw key found) =="
if grep -rniE "sk_live_[A-Za-z0-9]{16}|sk-ant|gho_|scrypt\\$|BEGIN [A-Z ]*PRIVATE KEY" hermes/ 9router/; then
    echo "SECRETS FOUND — aborting"; exit 1
fi

cd "$DOTFILES_REPO"
git add hermes 9router
git commit -m "backup(9router): export config snapshot $(date -u +%Y-%m-%d)" || echo "nothing to commit"
git push origin main
echo "== done =="
