# ─────────────────────────────────────────────────────────────
# packages.sh — the single source of truth for stow packages
#
# Sourced by bootstrap.sh, sync-dotfiles.sh and scripts/validate.sh. The lists
# used to be copy-pasted into each script, which let them drift (omp was
# documented as --no-folding but missing from both installers). Keep them here
# only.
#
# Not a stow package: omarchy is stowed by hand on Arch/Omarchy hosts, because
# ~/.config/hypr is meaningless on macOS. claude/jev/9router/hypr-lua are
# deployed by their own scripts, never stowed.
# ─────────────────────────────────────────────────────────────

# Every package the scripts may stow, in a stable order. resolve_selection()
# emits in this order so output is deterministic.
ALL_PACKAGES=(nvim tmux zsh vim opencode omp pi hermes pen dsh)

# Packages whose target directory also holds app-managed state. These must be
# stowed with --no-folding, or stow folds the whole directory into a single
# symlink pointing into the repo and the app writes its state into git.
#   omp:  ~/.omp holds agent/ (DBs, sessions), cache/, plugins/, logs/
#   pen:  ~/.pencil holds sessions/ and agent-auth
#   dsh:  ~/.dsh holds profiles/ (pnpm-managed), logs/, and .credentials.yaml;
#         the package also targets ~/.config/dsh and ~/.config/systemd/user,
#         both of which hold app-managed state beside the stowed files.
STOW_NO_FOLDING=(omp pen dsh)

# Named groups for the --harness / --editor / --shell shortcuts.
PACKAGE_GROUPS=(harness editor shell)

group_packages() {
    case "$1" in
        harness) printf '%s\n' omp opencode hermes pen pi dsh ;;
        editor)  printf '%s\n' nvim vim ;;
        shell)   printf '%s\n' zsh tmux ;;
        *) return 1 ;;
    esac
}

# resolve_selection <token>... — expand group names to packages, validate every
# name, de-duplicate, and print the result in ALL_PACKAGES order.
#
# An unknown name is a hard error (message on stderr, non-zero exit) rather than
# a silent no-op, so a typo cannot quietly stow nothing.
resolve_selection() {
    local wanted=() tok p w known expanded

    for tok in "$@"; do
        [ -n "$tok" ] || continue
        if expanded="$(group_packages "$tok")"; then
            for p in $expanded; do wanted+=("$p"); done
            continue
        fi

        known=false
        for p in "${ALL_PACKAGES[@]}"; do
            if [ "$tok" = "$p" ]; then known=true; fi
        done
        if [ "$known" = false ]; then
            echo "unknown package or group: $tok" >&2
            # ${arr[*]} honours the caller's IFS, which bootstrap.sh sets to
            # newline/tab; join explicitly so the lists read on one line.
            echo "  packages: $(IFS=' '; echo "${ALL_PACKAGES[*]}")" >&2
            echo "  groups:   $(IFS=' '; echo "${PACKAGE_GROUPS[*]}")" >&2
            return 1
        fi
        wanted+=("$tok")
    done

    for p in "${ALL_PACKAGES[@]}"; do
        for w in "${wanted[@]}"; do
            if [ "$p" = "$w" ]; then
                printf '%s\n' "$p"
                break
            fi
        done
    done
}

# stow_flags_for <package> — print the stow flags that package needs.
stow_flags_for() {
    local pkg="$1" nf
    for nf in "${STOW_NO_FOLDING[@]}"; do
        if [ "$pkg" = "$nf" ]; then
            printf '%s\n' --no-folding
            return 0
        fi
    done
    return 0
}
