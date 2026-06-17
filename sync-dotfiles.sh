#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# sync-dotfiles.sh — daily pull + restow for dotfiles
# ─────────────────────────────────────────────────────────────
set -euo pipefail

DOTFILES="${HOME}/dotfiles"
STOW_PACKAGES=(nvim tmux zsh vim opencode claude omp pi agent codex)

cd "$DOTFILES"

# Pull latest (ff-only to avoid merge commits)
git pull --ff-only origin main 2>&1 || echo "WARN: pull failed (uncommitted changes?)"

# Restow to catch any new/changed packages
for pkg in "${STOW_PACKAGES[@]}"; do
    if [[ -d "$DOTFILES/$pkg" ]]; then
        stow -D "$pkg" 2>/dev/null || true
    fi
done
for pkg in "${STOW_PACKAGES[@]}"; do
    if [[ -d "$DOTFILES/$pkg" ]]; then
        stow "$pkg" 2>/dev/null && echo "OK: stowed $pkg" || echo "WARN: stow $pkg failed"
    fi
done

# Validate key configs
if command -v jq &>/dev/null; then
    jq empty "$DOTFILES/opencode/.config/opencode/oh-my-openagent.json" 2>/dev/null && echo "OK: oh-my-openagent.json"
fi

echo "sync complete: $(date)"