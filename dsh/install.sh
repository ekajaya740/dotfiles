#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# dsh/install.sh — deploy the DeepSeek Harness wiring that cannot be stowed.
#
# `dsh` IS a stow package (see scripts/packages.sh, with --no-folding). Stow
# owns every file that is safe to symlink:
#
#   ~/.dsh/cordis.patch.yml                    ← home-level patch layer
#   ~/.config/systemd/user/dsh-web.service     ← unit (no secrets)
#   ~/.config/dsh/env.example                  ← template
#
# This script covers the rest, for two reasons:
#
#   1. dsh commits config writes with dsh-atomic-write, which writes a temp
#      sibling and rename()s it over the target. rename() REPLACES a symlink
#      with a regular file, so the write never reaches the repo and the link is
#      gone. dsh-plugin-manager calls it for package.json, so the profile
#      manifest and lockfile must stay machine-local. That is why the live
#      service env is COPIED, never symlinked, and why profiles/ is not stowed.
#   2. ~/.dsh/{sessions,storages,skills}, profiles/*/node_modules and
#      .credentials.yaml are machine state or secrets.
#
# So, like claude/ and jev/, this script reproduces the machine wiring:
#
#   1. ~/.config/dsh/env  ← copied from env.example if ABSENT (never
#                            overwritten: it holds the provider keys)
#   2. the profile's plugin set ← replayed from plugins.txt (--plugins)
#
# Run `stow dsh` (or bootstrap.sh / sync-dotfiles.sh) for the symlinked files;
# this script does not touch them.
#
# Idempotent. Writes no secrets.
#
#   ./install.sh             create the service env if missing
#   ./install.sh --plugins   also replay plugins.txt into the web profile
#   ./install.sh --check     show what would change, change nothing
# ─────────────────────────────────────────────────────────────
set -euo pipefail

CHECK=false
DO_PLUGINS=false
for arg in "$@"; do
    case "$arg" in
        --check)   CHECK=true ;;
        --plugins) DO_PLUGINS=true ;;
        -h|--help) sed -n '2,36p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "unknown option: $arg" >&2; exit 2 ;;
    esac
done

info() { printf '\033[1;34m[INFO]\033[0m  %s\n' "$*"; }
ok()   { printf '\033[1;32m[ OK ]\033[0m  %s\n' "$*"; }
warn() { printf '\033[1;33m[WARN]\033[0m  %s\n' "$*"; }
has()  { command -v "$1" >/dev/null 2>&1; }
run()  { if $CHECK; then echo "  [dry-run] $*"; else "$@"; fi; }

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DSH_DIR="$REPO_DIR/dsh"
ENV_EXAMPLE="$DSH_DIR/.config/dsh/env.example"
ENV_LIVE="$HOME/.config/dsh/env"
UNIT_SRC="$DSH_DIR/.config/systemd/user/dsh-web.service"
UNIT_LIVE="$HOME/.config/systemd/user/dsh-web.service"
PLUGINS_FILE="$DSH_DIR/plugins.txt"
PROFILE="${DSH_PROFILE:-web}"
DSH_HOME_LIVE="${DSH_HOME:-$HOME/.dsh}"

[[ -f "$ENV_EXAMPLE" ]] || { warn "missing $ENV_EXAMPLE"; exit 1; }
[[ -f "$UNIT_SRC" ]]    || { warn "missing $UNIT_SRC"; exit 1; }

# ── 1. service env (secrets) ─────────────────────────────────
# Copied, never symlinked and never overwritten: the live file holds provider
# keys and bot tokens and must stay machine-local.
install_env() {
    info "service env"
    if [[ -f "$ENV_LIVE" ]]; then
        ok "exists, left untouched: $ENV_LIVE"
        return 0
    fi
    if $CHECK; then
        echo "  [dry-run] cp $ENV_EXAMPLE $ENV_LIVE && chmod 600 $ENV_LIVE"
        echo "  [dry-run] then fill in the keys by hand"
        return 0
    fi
    mkdir -p "$(dirname "$ENV_LIVE")"
    cp "$ENV_EXAMPLE" "$ENV_LIVE"
    chmod 600 "$ENV_LIVE"
    ok "created $ENV_LIVE — FILL IN THE KEYS before starting dsh-web"
}

# ── 2. stowed files present ──────────────────────────────────
# Stow owns the symlinked files. Verify rather than link them here, so there is
# exactly one owner and `stow dsh` never hits a target it does not own.
check_stowed() {
    info "stowed files"
    local ok_all=true
    for f in "$HOME/.dsh/cordis.patch.yml" \
             "$UNIT_LIVE" \
             "$HOME/.config/dsh/env.example"; do
        if [[ -L "$f" ]]; then
            # An absolute link means something other than stow created it (stow
            # always writes a relative one). That is a real failure: stow then
            # refuses the package with "existing target is not owned by stow",
            # which blocks the whole dsh package. Catch it rather than report OK.
            if [[ "$(readlink "$f")" == /* ]]; then
                warn "absolute symlink (not stow-owned): $f"
                ok_all=false
            else
                ok "linked: $f"
            fi
        elif [[ -e "$f" ]]; then
            warn "regular file (not stowed): $f"
            ok_all=false
        else
            warn "missing: $f — run: stow dsh"
            ok_all=false
        fi
    done

    # The unit hardcodes /home/personal. Flag a mismatch rather than letting a
    # service silently fail to start on another machine.
    if grep -q '/home/personal' "$UNIT_SRC" && [[ "$HOME" != "/home/personal" ]]; then
        warn "unit hardcodes /home/personal but HOME=$HOME — edit $UNIT_SRC"
    fi

    if has systemctl; then
        run systemctl --user daemon-reload || warn "daemon-reload failed"
    fi
    $ok_all || warn "run: cd $REPO_DIR && stow --no-folding dsh"
}

# ── 3. plugin set ────────────────────────────────────────────
# Replays plugins.txt. Stops dsh-web first: `dsh plugin` takes the profile write
# lock, and a concurrent server can race it. Then restarts and prints the new
# auth token.
install_plugins() {
    info "profile plugins ($PROFILE)"
    has dsh || { warn "dsh not on PATH — skipping plugin replay"; return 0; }

    local specs=()
    while IFS= read -r line; do
        line="${line%%#*}"
        line="$(printf '%s' "$line" | tr -d '[:space:]')"
        [[ -n "$line" ]] && specs+=("$line")
    done < "$PLUGINS_FILE"

    [[ ${#specs[@]} -gt 0 ]] || { warn "no specs in $PLUGINS_FILE"; return 0; }

    if $CHECK; then
        echo "  [dry-run] systemctl --user stop dsh-web"
        for s in "${specs[@]}"; do echo "  [dry-run] dsh plugin --profile $PROFILE add $s"; done
        echo "  [dry-run] systemctl --user start dsh-web"
        return 0
    fi

    local was_active=false
    if has systemctl && systemctl --user is-active --quiet dsh-web; then
        was_active=true
        info "stopping dsh-web to take the profile lock"
        systemctl --user stop dsh-web
    fi

    local failed=0
    for s in "${specs[@]}"; do
        if dsh plugin --profile "$PROFILE" add "$s" >/dev/null 2>&1; then
            ok "added $s"
        else
            # Already-installed plugins are not an error worth stopping for;
            # report and continue so one bad spec does not block the rest.
            warn "could not add $s (already installed, or rejected)"
            failed=$((failed + 1))
        fi
    done

    # A near-duplicate of a harness-provided core package (dsh-tools,
    # dsh-settings) in profiles/$PROFILE/node_modules splits module identity and
    # breaks tool dispatch with "Cannot read properties of undefined
    # (reading 'prepare')". Check after every plugin operation.
    local nm="$DSH_HOME_LIVE/profiles/$PROFILE/node_modules/@deepseek-ai"
    if [[ -d "$nm" ]]; then
        local dup=""
        for c in dsh-tools dsh-settings; do
            [[ -e "$nm/$c" ]] && dup="$dup $c"
        done
        if [[ -n "$dup" ]]; then
            warn "core package(s) duplicated into the profile:$dup"
            warn "  this breaks tool calls; remove them from the profile's"
            warn "  package.json dependencies, delete pnpm-lock.yaml, re-run"
            warn "  pnpm install, then restart dsh-web."
        else
            ok "no core-package duplicate in the profile"
        fi
    fi

    if $was_active; then
        info "restarting dsh-web"
        systemctl --user start dsh-web
        sleep 3
        systemctl --user is-active --quiet dsh-web \
            && ok "dsh-web active" \
            || warn "dsh-web did not come back — check: journalctl --user -u dsh-web -n 40"
        info "auth URL (fresh token per boot):"
        journalctl --user -u dsh-web -n 30 --no-pager 2>/dev/null \
            | grep -oE 'http://127\.0\.0\.1:[0-9]+/\?token=\S+' | tail -1 | sed 's/^/  /'
    fi

    [[ $failed -eq 0 ]] || warn "$failed spec(s) not applied"
}

install_env
check_stowed
$DO_PLUGINS && install_plugins

echo
if $CHECK; then
    info "dry run complete — nothing changed"
else
    ok "dsh wiring complete"
    $DO_PLUGINS || info "plugin set not replayed (pass --plugins to apply it)"
fi
