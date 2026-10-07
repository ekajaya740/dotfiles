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

# ── package selection ────────────────────────────────────────
# Same flags as bootstrap.sh. Names and groups come from scripts/packages.sh.
SELECTION=()
SELECT_ALL=false

usage() {
    cat <<'EOF'
Usage: sync-dotfiles.sh [options]

  --only LIST    Restow only these packages, comma-separated
                 e.g. --only omp,hermes,pen
  --harness      Shortcut for the agent harness configs
  --editor       Shortcut for nvim vim
  --shell        Shortcut for zsh tmux
  --all          Restow every package (the default)
  --sync-only    Accepted for symmetry with bootstrap.sh; this script always
                 only restows, so the flag changes nothing
  -h, --help     Show this help

Packages and groups are defined in scripts/packages.sh.
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --only)
            [[ -n "${2:-}" ]] || { echo "ERROR: --only needs a value, e.g. --only omp,hermes"; exit 1; }
            IFS=', ' read -r -a _only <<< "$2"
            for _p in ${_only[@]+"${_only[@]}"}; do [[ -n "$_p" ]] && SELECTION+=("$_p"); done
            shift 2
            ;;
        --harness|--editor|--shell) SELECTION+=("${1#--}"); shift ;;
        --all) SELECT_ALL=true; shift ;;
        # This script is always sync-only; the flag is accepted so the same
        # command line works for bootstrap.sh and sync-dotfiles.sh alike.
        --sync-only) shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "ERROR: unknown flag: $1"; usage >&2; exit 1 ;;
    esac
done

# Run git/stow from the repo: stow uses CWD as its source dir and looks for
# .stowrc relative to it, so a wrong CWD would stow the wrong tree.
cd "$DOTFILES"

# Package lists and the --no-folding rule live in scripts/packages.sh, shared
# with bootstrap.sh and the CI validator so the three cannot drift apart.
# shellcheck source=scripts/packages.sh
source "$DOTFILES/scripts/packages.sh"

# Which packages this run should touch.
if $SELECT_ALL || [[ ${#SELECTION[@]} -eq 0 ]]; then
    STOW_SELECTION=("${ALL_PACKAGES[@]}")
else
    resolved="$(resolve_selection ${SELECTION[@]+"${SELECTION[@]}"})" \
        || { echo "ERROR: invalid package selection"; exit 1; }
    [[ -n "$resolved" ]] || { echo "ERROR: no packages selected"; exit 1; }
    STOW_SELECTION=()
    while IFS= read -r _pkg; do STOW_SELECTION+=("$_pkg"); done <<< "$resolved"
fi

# Pull latest (ff-only to avoid merge commits)
git pull --ff-only origin main 2>&1 || echo "WARN: pull failed (uncommitted changes?)"

echo "restowing: $(IFS=' '; echo "${STOW_SELECTION[*]}")"

# Restow to catch any new/changed packages. The unstow pass must cover the same
# set as the stow pass: unstowing everything and then stowing only a subset
# would unlink the packages that were not selected.
for pkg in ${STOW_SELECTION[@]+"${STOW_SELECTION[@]}"}; do
    if [[ -d "$DOTFILES/$pkg" ]]; then
        stow -D "$pkg" 2>/dev/null || true
    fi
done
for pkg in ${STOW_SELECTION[@]+"${STOW_SELECTION[@]}"}; do
    if [[ -d "$DOTFILES/$pkg" ]]; then
        flags=()
        while IFS= read -r f; do
            [[ -n "$f" ]] && flags+=("$f")
        done < <(stow_flags_for "$pkg")
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