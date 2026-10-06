#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# sync-dotfiles.sh — daily pull + restow for dotfiles
# ─────────────────────────────────────────────────────────────
set -euo pipefail

DOTFILES="${HOME}/dotfiles"

# Fail loudly up front. `stow` is invoked below under `set -e`, so a bare
# `cd`/missing tool would abort mid-run with a confusing exit code.
[[ -d "$DOTFILES/.git" ]] || { echo "ERROR: no dotfiles repo at $DOTFILES"; exit 1; }
command -v stow >/dev/null || { echo "ERROR: stow is not installed"; exit 1; }

# Keep this list to packages that exist in the repo and are tracked. `codex` is
# not in the repo at all and would only ever emit a skip warning. `claude/` is
# also excluded — it is deployed by claude/install.sh, not stowed (the claude
# CLI rewrites settings.json, so a symlink would not survive).
STOW_PACKAGES=(nvim tmux zsh vim opencode omp pi hermes pen)

# pen: ~/.pencil also holds app state (sessions/, agent-auth), so it must not be
# folded into a single symlink pointing at the repo.
STOW_NO_FOLDING=(pen)

# Run git/stow from the repo: stow uses CWD as its source dir and looks for
# .stowrc relative to it, so a wrong CWD would stow the wrong tree.
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
        flags=()
        for nf in "${STOW_NO_FOLDING[@]}"; do
            [[ "$pkg" == "$nf" ]] && flags+=(--no-folding)
        done
        stow ${flags[@]+"${flags[@]}"} "$pkg" 2>/dev/null && echo "OK: stowed $pkg" || echo "WARN: stow $pkg failed"
    fi
done

# Guard against secrets that surfaced from an app writing state into a stowed
# dir (see the pen note above). Tracked files only, and this script is excluded so
# the pattern below cannot match itself.
secret_re='sk_live_[A-Za-z0-9]{16}|sk-ant-[A-Za-z0-9_-]{20}|ghp_[A-Za-z0-9]{36}|BEGIN [A-Z ]*PRIVATE KEY'
secret_hits=$(git ls-files -z -- . ':!sync-dotfiles.sh' | xargs -0 grep -lIE "$secret_re" 2>/dev/null || true)
if [[ -n "$secret_hits" ]]; then
    echo "ERROR: possible secret in tracked files — review before committing"
    echo "$secret_hits" | sed 's/^/  /'
fi

# Validate key configs
if command -v jq &>/dev/null; then
    jq empty "$DOTFILES/opencode/.config/opencode/oh-my-openagent.json" 2>/dev/null && echo "OK: oh-my-openagent.json"
    jq empty "$DOTFILES/pen/.pencil/models.json" 2>/dev/null && echo "OK: pen models.json"
    jq empty "$DOTFILES/claude/.claude/settings.json" 2>/dev/null && echo "OK: claude settings.json"
fi

# Claude user-scope MCP servers are merged (never stowed) into ~/.claude.json,
# which also holds secrets and project state.
if [[ -f "$DOTFILES/claude/install.sh" ]]; then
    bash "$DOTFILES/claude/install.sh" >/dev/null 2>&1 && echo "OK: claude MCP servers merged" || echo "WARN: claude MCP merge failed"
fi


echo "sync complete: $(date)"