#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# dsh/install.sh — deploy the DeepSeek Harness wiring that cannot be stowed.
#
# `dsh` IS a stow package (see scripts/packages.sh, with --no-folding). Stow
# owns every file that is safe to symlink:
#
#   ~/.dsh/cordis.patch.yml                    ← home-level patch layer
#   ~/.dsh-superagent-personal/cordis.patch.yml ← its home patch (2nd instance)
#   ~/.config/systemd/user/dsh-web.service     ← unit (no secrets)
#   ~/.config/dsh/env.example                  ← template
#
# This script covers the rest, for two reasons:
#
#   1. dsh commits config writes with dsh-atomic-write, which writes a temp
#      sibling and rename()s it over the target. rename() REPLACES a symlink
#      with a regular file, so the write never reaches the repo and the link is
#      gone. dsh-plugin-manager calls it for package.json and pnpm-workspace,
#      and dsh-config-editor calls it for every settings save (its write target
#      IS cordis.patch.yml), so the whole profile must stay machine-local. That
#      is why the live service env is COPIED, never symlinked, and why
#      profiles/ is not stowed.
#   2. ~/.dsh/{sessions,storages,skills}, profiles/*/node_modules and
#      .credentials.yaml are machine state or secrets.
#
# So, like claude/ and jev/, this script reproduces the machine wiring:
#
#   1. ~/.config/dsh/env  ← copied from env.example if ABSENT (never
#                            overwritten: it holds the provider keys)
#   2. the profile's plugin set ← replayed from plugins.txt (--plugins)
#   3. the profile config ← seeded from dsh/.dsh{,-superagent-personal}/profiles/
#      (--profiles) into the matching DSH_HOME
#   4. the vendored plugins ← linked into ~/.dsh-local-plugins/ (--local-plugins)
#
# Run `stow dsh` (or bootstrap.sh / sync-dotfiles.sh) for the symlinked files;
# this script does not touch them.
#
# Idempotent. Writes no secrets.
#
#   ./install.sh             create the service env if missing; report drift
#   ./install.sh --profiles  also seed the profile config from the repo
#   ./install.sh --capture   copy the LIVE profile config back into the repo
#                            (do this after changing settings in the UI)
#   ./install.sh --plugins   also replay plugins.txt into the web profile
#   ./install.sh --local-plugins
#                            link dsh/local-plugins/<name> into
#                            ~/.dsh-local-plugins/<name>, which the profile
#                            manifest's relative `link:` deps resolve to
#   ./install.sh --check     show what would change, change nothing
# ─────────────────────────────────────────────────────────────
set -euo pipefail

CHECK=false
DO_PLUGINS=false
DO_PROFILES=false
DO_CAPTURE=false
DO_LOCAL_PLUGINS=false
for arg in "$@"; do
    case "$arg" in
        --check)         CHECK=true ;;
        --plugins)       DO_PLUGINS=true ;;
        --profiles)      DO_PROFILES=true ;;
        --capture)       DO_CAPTURE=true ;;
        --local-plugins) DO_LOCAL_PLUGINS=true ;;
        -h|--help)  sed -n '2,44p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
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
WEB_ENV_EXAMPLE="$DSH_DIR/.config/dsh/web.env.example"
WEB_ENV_LIVE="$HOME/.config/dsh/web.env"
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
    elif $CHECK; then
        echo "  [dry-run] cp $ENV_EXAMPLE $ENV_LIVE && chmod 600 $ENV_LIVE"
        echo "  [dry-run] then fill in the keys by hand"
    else
        mkdir -p "$(dirname "$ENV_LIVE")"
        cp "$ENV_EXAMPLE" "$ENV_LIVE"
        chmod 600 "$ENV_LIVE"
        ok "created $ENV_LIVE — FILL IN THE KEYS before starting dsh-web"
    fi

    # The per-host proxy authorities. Only placeholders: a public-only host can
    # leave both values commented out, and the service still works.
    if [[ -f "$WEB_ENV_LIVE" ]]; then
        ok "exists, left untouched: $WEB_ENV_LIVE"
    elif [[ -f "$WEB_ENV_EXAMPLE" ]]; then
        if $CHECK; then
            echo "  [dry-run] cp $WEB_ENV_EXAMPLE $WEB_ENV_LIVE && chmod 600 $WEB_ENV_LIVE"
            echo "  [dry-run] then fill in this host's extra authorities, if any"
        else
            mkdir -p "$(dirname "$WEB_ENV_LIVE")"
            cp "$WEB_ENV_EXAMPLE" "$WEB_ENV_LIVE"
            chmod 600 "$WEB_ENV_LIVE"
            ok "created $WEB_ENV_LIVE — optional, fill in extra authorities"
        fi
    else
        warn "missing $WEB_ENV_EXAMPLE"
    fi
}

# ── 2. stowed files present ──────────────────────────────────
# Stow owns the symlinked files. Verify rather than link them here, so there is
# exactly one owner and `stow dsh` never hits a target it does not own.
check_stowed() {
    info "stowed files"
    local ok_all=true
    for f in "$HOME/.dsh/cordis.patch.yml" \
             "$UNIT_LIVE" \
             "$HOME/.config/dsh/env.example" \
             "$HOME/.config/dsh/web.env.example"; do
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

    # The unit must stay host-agnostic: it uses %h so it works for any user on
    # any machine. An absolute /home/<user> or /Users/<user> path would pin it
    # to one box and make the service fail to start elsewhere, so flag it.
    if grep -qE '(/home/|/Users/)[A-Za-z0-9._-]+' "$UNIT_SRC"; then
        warn "unit contains an absolute home path — use %h instead: $UNIT_SRC"
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

# ── 4. profile config (seed, not symlink) ───────────────────
# The profile's own config cannot be stowed: dsh's writeFileAtomic rename()s a
# temp file over the target, which replaces a symlink instead of writing
# through it. So the repo holds a SEED that this copies in, and --capture pulls
# live edits back. Only intent files are versioned; pnpm-lock.yaml and the
# node_modules tree are derived and stay machine-local.
SEED_FILES=(cordis.patch.yml package.json pnpm-workspace.yaml compatibility.json)

# Two DSH_HOMEs are seeded, each with its own profiles/ tree. Only the homes
# this repo owns are listed: ~/.dsh (web + headless + tui) and
# ~/.dsh-superagent-personal. PROFILL (~/.dsh-profill), its superagent sibling
# (~/.dsh-superagent-profill) and the default ~/.dsh profiles/profill are out
# of scope — they belong to the profill agent and are never touched here.
#   repo dsh/.dsh/                     → $HOME/.dsh
#   repo dsh/.dsh-superagent-personal/ → $HOME/.dsh-superagent-personal
SEED_HOMES=(.dsh .dsh-superagent-personal)

# seed_home <repo-subdir> <live-dir> <direction: seed|capture>
seed_home() {
    local src_root="$DSH_DIR/$1/profiles"
    local live_root="$2/profiles"
    local direction="$3"
    local p f src dst changed=0 conflict=0

    if [[ "$direction" == seed ]]; then
        [[ -d "$src_root" ]] || { warn "missing $src_root"; return 0; }
        info "profile config (seed → live): $2"
    else
        [[ -d "$live_root" ]] || { warn "missing $live_root"; return 0; }
        info "profile config (live → repo): $1"
    fi

    if [[ "$direction" == seed ]]; then
        for p in "$src_root"/*/; do
            p="$(basename "$p")"
            for f in "${SEED_FILES[@]}"; do
                src="$src_root/$p/$f"
                dst="$live_root/$p/$f"
                [[ -f "$src" ]] || continue
                if [[ -f "$dst" ]] && cmp -s "$src" "$dst"; then
                    continue
                fi
                changed=$((changed + 1))
                if [[ -f "$dst" ]]; then
                    # The live file exists and differs. Do NOT clobber: it may
                    # hold a settings change made in the UI that was never
                    # captured. Say so and let the operator choose.
                    conflict=$((conflict + 1))
                    warn "differs, left untouched: $dst"
                    echo "        repo → $src"
                    echo "        adopt the live version: ./install.sh --capture"
                    echo "        overwrite with the repo:  cp '$src' '$dst'"
                else
                    run mkdir -p "$(dirname "$dst")"
                    run cp "$src" "$dst"
                    ok "seeded $dst"
                fi
            done
        done
    else
        for p in "$live_root"/*/; do
            p="$(basename "$p")"
            for f in "${SEED_FILES[@]}"; do
                src="$live_root/$p/$f"
                dst="$src_root/$p/$f"
                [[ -f "$src" ]] || continue
                if [[ -f "$dst" ]] && cmp -s "$src" "$dst"; then
                    continue
                fi
                if $CHECK; then
                    echo "  [dry-run] cp $src $dst"
                    continue
                fi
                mkdir -p "$(dirname "$dst")"
                cp "$src" "$dst"
                ok "captured $dst"
            done
        done
    fi

    if [[ "$direction" == seed ]]; then
        if [[ $changed -eq 0 ]]; then
            ok "profile config matches the repo"
        elif [[ $conflict -gt 0 ]]; then
            warn "$conflict file(s) drifted from the repo — resolve them (see above)"
        else
            info "$changed file(s) seeded"
        fi
    fi
}

install_profiles() {
    local h
    for h in "${SEED_HOMES[@]}"; do seed_home "$h" "$HOME/$h" seed; done
}

capture_profiles() {
    local h
    for h in "${SEED_HOMES[@]}"; do seed_home "$h" "$HOME/$h" capture; done

    if ! $CHECK && command -v git >/dev/null 2>&1; then
        if ! git -C "$REPO_DIR" diff --quiet -- "$DSH_DIR/.dsh" "$DSH_DIR/.dsh-superagent-personal" 2>/dev/null; then
            info "review before committing:"
            echo "  git -C $REPO_DIR diff -- ${DSH_DIR#"$REPO_DIR"/}"
        fi
    fi
}

# ── 5. vendored local plugins ───────────────────────────────
# Five first-party plugins live in the repo at dsh/local-plugins/<name> rather
# than a registry. The profile manifest depends on them as RELATIVE link: deps
# (link:../../../.dsh-local-plugins/<name>), which resolves to
# ~/.dsh-local-plugins/<name> from ~/.dsh/profiles/web. Symlink them there so a
# fresh machine's `pnpm install` can resolve every dependency and no seed has to
# carry an absolute path.
LOCAL_PLUGINS_SRC="$DSH_DIR/local-plugins"
LOCAL_PLUGINS_LIVE="$HOME/.dsh-local-plugins"

install_local_plugins() {
    info "local plugins (repo → $LOCAL_PLUGINS_LIVE)"
    [[ -d "$LOCAL_PLUGINS_SRC" ]] || { warn "missing $LOCAL_PLUGINS_SRC"; return 0; }

    local name src dst
    for src in "$LOCAL_PLUGINS_SRC"/*/; do
        name="$(basename "$src")"
        dst="$LOCAL_PLUGINS_LIVE/$name"
        if [[ -L "$dst" ]]; then
            if [[ "$(readlink "$dst")" == "$LOCAL_PLUGINS_SRC/$name" ]]; then
                ok "linked: $dst"
                continue
            fi
            warn "link points elsewhere, replacing: $dst"
        elif [[ -e "$dst" ]]; then
            # A real directory here means someone worked on the plugin outside
            # the repo. Do not delete their tree; report it.
            warn "real directory, left untouched: $dst"
            continue
        fi
        run mkdir -p "$LOCAL_PLUGINS_LIVE"
        run ln -sfn "$LOCAL_PLUGINS_SRC/$name" "$dst"
        ok "linked $dst → $src"
    done
}

install_env
check_stowed
$DO_PROFILES      && install_profiles
$DO_CAPTURE       && capture_profiles
$DO_LOCAL_PLUGINS && install_local_plugins
$DO_PLUGINS       && install_plugins

echo
if $CHECK; then
    info "dry run complete — nothing changed"
else
    ok "dsh wiring complete"
    $DO_PLUGINS       || info "plugin set not replayed (pass --plugins to apply it)"
    $DO_PROFILES      || info "profile config not seeded (pass --profiles to apply it)"
    $DO_LOCAL_PLUGINS || info "local plugins not linked (pass --local-plugins to apply it)"
fi
