#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# validate.sh — the repo's checks, in one place
#
# Run from anywhere; it resolves the repo root itself. Every check is
# fail-closed: a non-zero exit means something is actually wrong, so CI can
# gate on this script without any `|| true`.
#
#   1. ShellCheck on every shell script (severity: warning)
#   2. JSON parses
#   3. YAML parses (harness configs)
#   4. stow --simulate for every package, into a scratch target
#   5. release script can parse CHANGELOG.md
# ─────────────────────────────────────────────────────────────
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

# Package lists come from scripts/packages.sh — the same file the installers
# source. They used to be copied here, which let the CI dry run drift from what
# bootstrap.sh and sync-dotfiles.sh actually stow.
# shellcheck source=scripts/packages.sh
source "$REPO/scripts/packages.sh"
STOW_PACKAGES=("${ALL_PACKAGES[@]}")

failures=0
note() { printf '\033[1;34m▸\033[0m %s\n' "$*"; }
pass() { printf '\033[1;32m  ✓\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m  ✗\033[0m %s\n' "$*"; failures=$((failures + 1)); }

# ── 1. ShellCheck ────────────────────────────────────────────
# .shellcheckrc sets shell=bash and disables SC1090/SC1091. The severity is
# passed explicitly: older ShellCheck builds do not apply `severity` from the
# rcfile, and a gate that silently reports nothing is worse than no gate.
note "ShellCheck"
if command -v shellcheck >/dev/null 2>&1; then
    shell_files=()
    while IFS= read -r f; do shell_files+=("$f"); done < <(git ls-files '*.sh')
    if shellcheck --shell=bash --severity=warning "${shell_files[@]}"; then
        pass "${#shell_files[@]} shell scripts clean"
    else
        fail "ShellCheck reported findings (see above)"
    fi
else
    fail "shellcheck not installed"
fi

# ── 2. JSON ──────────────────────────────────────────────────
note "JSON configs"
json_ok=0
json_bad=0
while IFS= read -r f; do
    if jq empty "$f" 2>/dev/null; then
        json_ok=$((json_ok + 1))
    else
        fail "invalid JSON: $f"
        json_bad=$((json_bad + 1))
    fi
done < <(git ls-files '*.json' '*.json.template')
[ "$json_bad" -eq 0 ] && pass "$json_ok JSON files parse"

# ── 3. YAML ──────────────────────────────────────────────────
note "YAML configs"
if python3 -c 'import yaml' 2>/dev/null; then
    yaml_ok=0
    yaml_bad=0
    while IFS= read -r f; do
        if python3 -c "import sys, yaml; yaml.safe_load(open(sys.argv[1]))" "$f" 2>/dev/null; then
            yaml_ok=$((yaml_ok + 1))
        else
            fail "invalid YAML: $f"
            yaml_bad=$((yaml_bad + 1))
        fi
    done < <(git ls-files '*.yml' '*.yaml' | grep -v '^\.github/')
    [ "$yaml_bad" -eq 0 ] && pass "$yaml_ok YAML files parse"

    # cordis.patch.yml is consumed by dsh as a list of patch rows. A
    # comments-only file parses as null, which is not an empty list — dsh would
    # fail to compose the layer. Checking "it parses" is not enough.
    for patch in $(git ls-files '**/cordis.patch.yml'); do
        shape="$(python3 -c "
import sys, yaml
doc = yaml.safe_load(open(sys.argv[1]))
print('list' if isinstance(doc, list) else type(doc).__name__)
" "$patch" 2>/dev/null)"
        if [ "$shape" = "list" ]; then
            pass "$patch is a patch list"
        else
            fail "$patch must be a list of patch rows, got: ${shape:-unparseable}"
        fi
    done

    # The dsh patch's telemetry opt-outs are load-bearing: both egresses default
    # to enabled, so dropping a row silently re-enables an upload that carries
    # message text. Shape alone would not catch that, so assert the rows.
    dsh_patch="$(git ls-files 'dsh/**/cordis.patch.yml' | head -1)"
    if [ -n "$dsh_patch" ]; then
        if missing="$(python3 -c "
import sys, yaml
rows = yaml.safe_load(open(sys.argv[1]))
off = {r['id'] for r in rows
       if isinstance(r, dict) and isinstance(r.get('config'), dict)
       and r['config'].get('enabled') is False}
required = {'session-log-deepseek', 'plugin-package-inventory-deepseek'}
print(','.join(sorted(required - off)))
" "$dsh_patch" 2>/dev/null)" && [ -z "$missing" ]; then
            pass "dsh telemetry opt-out rows present"
        else
            fail "dsh patch is missing enabled:false for: ${missing:-unparseable}"
        fi
    fi
else
    fail "pyyaml not installed"
fi

# ── 4. stow dry run ──────────────────────────────────────────
# Simulating into a scratch target proves every tracked file still maps to a
# real destination, without touching $HOME. stow always prints the
# "simulation mode" notice to stderr, so it is filtered; anything else it says
# is a genuine conflict.
note "stow --simulate"
if command -v stow >/dev/null 2>&1; then
    scratch="$(mktemp -d)"
    trap 'rm -rf "$scratch"' EXIT

    stow_bad=0
    for pkg in "${STOW_PACKAGES[@]}"; do
        [ -d "$pkg" ] || { fail "package directory missing: $pkg"; stow_bad=$((stow_bad + 1)); continue; }

        flags=()
        for nf in "${STOW_NO_FOLDING[@]}"; do
            [ "$pkg" = "$nf" ] && flags+=(--no-folding)
        done

        if out="$(stow --simulate -t "$scratch" ${flags[@]+"${flags[@]}"} "$pkg" 2>&1)"; then
            # Drop stow's own notice; anything left means a conflict.
            leftover="$(printf '%s\n' "$out" | grep -v 'simulation mode' || true)"
            if [ -n "$leftover" ]; then
                fail "stow $pkg: $leftover"
                stow_bad=$((stow_bad + 1))
            fi
        else
            fail "stow $pkg failed: $out"
            stow_bad=$((stow_bad + 1))
        fi
    done
    [ "$stow_bad" -eq 0 ] && pass "${#STOW_PACKAGES[@]} packages simulate clean"
else
    fail "stow not installed"
fi

# ── 5. Release metadata ──────────────────────────────────────
# --check also validates the changelog is coherent, so a malformed version
# heading is caught here rather than at release time.
note "Release metadata"
if python3 scripts/release_dotfiles.py --check >/dev/null 2>&1; then
    pass "CHANGELOG.md parses"
else
    fail "CHANGELOG.md did not parse:"
    python3 scripts/release_dotfiles.py --check || true
fi

# ── result ───────────────────────────────────────────────────
echo
if [ "$failures" -eq 0 ]; then
    printf '\033[1;32m✓ all checks passed\033[0m\n'
    exit 0
fi
printf '\033[1;31m✗ %d check(s) failed\033[0m\n' "$failures"
exit 1
