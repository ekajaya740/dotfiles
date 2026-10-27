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
#  3b. harness invariants (RTK, combo order, smol roles, catalog, windows)
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
    # dsh patch layers may carry `!!js` expressions (dsh evaluates them, PyYAML
    # does not know the tag). Register a permissive loader for the non-standard
    # tags so the shape checks below can still parse the document. Anything
    # else stays strict: safe_load still rejects unknown plain tags.
    yaml_py='
import sys, yaml
class DshLoader(yaml.SafeLoader):
    pass
def _passthrough(loader, node):
    return loader.construct_scalar(node) if isinstance(node, yaml.ScalarNode) else None
DshLoader.add_constructor("tag:yaml.org,2002:js", _passthrough)
DshLoader.add_constructor("!js", _passthrough)
def load(path):
    with open(path) as fh:
        return yaml.load(fh, Loader=DshLoader)
'
    yaml_ok=0
    yaml_bad=0
    while IFS= read -r f; do
        if python3 -c "$yaml_py"'
load(sys.argv[1])
' "$f" 2>/dev/null; then
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
        shape="$(python3 -c "$yaml_py"'
doc = load(sys.argv[1])
print("list" if isinstance(doc, list) else type(doc).__name__)
' "$patch" 2>/dev/null)"
        if [ "$shape" = "list" ]; then
            pass "$patch is a patch list"
        else
            fail "$patch must be a list of patch rows, got: ${shape:-unparseable}"
        fi
    done

    # The dsh patch's telemetry opt-outs are load-bearing: both egresses default
    # to enabled, so dropping a row silently re-enables an upload that carries
    # message text. Shape alone would not catch that, so assert the rows.
    # Pinned to the HOME-LEVEL patch: dsh/.dsh/profiles/*/cordis.patch.yml are
    # per-profile seeds and carry their own config rows, so a glob with head -1
    # would pick an arbitrary one.
    dsh_patch="dsh/.dsh/cordis.patch.yml"
    if [ -f "$dsh_patch" ]; then
        if missing="$(python3 -c "$yaml_py"'
rows = load(sys.argv[1])
off = {r["id"] for r in rows
       if isinstance(r, dict) and isinstance(r.get("config"), dict)
       and r["config"].get("enabled") is False}
required = {"session-log-deepseek", "plugin-package-inventory-deepseek"}
print(",".join(sorted(required - off)))
' "$dsh_patch" 2>/dev/null)" && [ -z "$missing" ]; then
            pass "dsh telemetry opt-out rows present"
        else
            fail "dsh patch is missing enabled:false for: ${missing:-unparseable}"
        fi
    fi

    # The dsh profile seeds are shared across machines, so an absolute path in
    # one is a landmine: a `link:`/`command:` under /home/personal resolves on
    # exactly one box and makes `pnpm install` fail everywhere else. It has
    # already happened once, so gate it rather than trust review.
    host_paths="$(grep -rn '/home/personal' dsh/.dsh/profiles/ 2>/dev/null \
        | grep -v '^[^:]*:[0-9]*:#' || true)"
    if [ -z "$host_paths" ]; then
        pass "dsh profile seeds carry no host-specific paths"
    else
        fail "host-specific path in a dsh profile seed (must be installed per host, not seeded):"
        printf '%s\n' "$host_paths" | sed 's/^/      /'
    fi
else
    fail "pyyaml not installed"
fi

# ── 3b. Harness invariants ───────────────────────────────────
# These are the settings that make the cheap path actually cheap. Each one has
# already been found off-by-default at least once, and each one is silent when
# wrong: RTK off just re-sends tool output, `smart` instead of `fallback` just
# spends a judge round trip per turn to re-derive an order that already encodes
# the policy, and omp re-injecting a 66-skill catalog costs prefix tokens on
# every single request. Shape checks do not catch any of that, so assert the
# values.
note "Harness invariants"
if python3 -c 'import yaml' 2>/dev/null; then
    if inv="$(python3 -c "
import json, sys, yaml

problems = []

# 9router: the exported snapshot is the only tracked copy of live settings.
try:
    export = json.load(open('9router/config-export.json'))
except Exception as e:
    problems.append('config-export.json unreadable: %s' % e)
else:
    s = export.get('settings') or {}
    if s.get('rtkEnabled') is not True:
        problems.append('9router settings.rtkEnabled must be true (got %r) '
                        '- RTK tool-output compression is the growth lever'
                        % (s.get('rtkEnabled'),))
    if s.get('comboStrategy') != 'fallback':
        problems.append('9router settings.comboStrategy must be \"fallback\" '
                        '(got %r) - the smart router picks on vendor names '
                        'alone, adds a round trip per turn, and cannot be '
                        'locked by strict because a rejection never writes '
                        'a sticky entry' % (s.get('comboStrategy'),))
    strategies = s.get('comboStrategies') or {}
    combos = {c.get('name') for c in export.get('combos') or []}
    orphan = sorted(set(strategies) - combos)
    if orphan:
        problems.append('comboStrategies names combos that do not exist: %s'
                        % ', '.join(orphan))
    smart = sorted(n for n, c in strategies.items()
                   if (c or {}).get('fallbackStrategy') == 'smart')
    if smart:
        problems.append('%d combo(s) still use the smart router (%s) - the '
                        'judge sees only vendor names, so its order cannot '
                        'beat cheapest-first, and a below-threshold answer '
                        'never writes a sticky entry'
                        % (len(smart), ', '.join(smart[:3])))

# omp: catalog pruning + the compaction ceiling.
try:
    cfg = yaml.safe_load(open('omp/.omp/agent/config.yml')) or {}
except Exception as e:
    problems.append('omp config.yml unreadable: %s' % e)
else:
    skills = cfg.get('skills') or {}
    # Only the agents catalogue is wanted: it holds the user's own utility
    # skills. Every other source would add a second copy of somebody else's
    # catalogue to the prefix.
    for key in ('enableCodexUser', 'enableClaudeUser', 'enableClaudeProject',
                'enablePiUser', 'enablePiProject', 'enableAgentsProject'):
        if skills.get(key) is not False:
            problems.append('omp skills.%s must be false - only the agents '
                            'catalogue is wanted; every other enabled source '
                            'injects a second catalogue into every request' % key)
    if skills.get('enableAgentsUser') is not True:
        problems.append('omp skills.enableAgentsUser must be true - it is the '
                        'catalogue that carries the utility skills')
    ignored = skills.get('ignoredSkills') or []
    for pattern in ('jev-*', 'loopx*'):
        if pattern not in ignored:
            problems.append('omp skills.ignoredSkills must ignore %r - every '
                            'skill under it needs a CLI that is not on this '
                            'host, so it is pure prefix cost' % pattern)
    roles = cfg.get('modelRoles') or {}
    for role in ('smol', 'tiny'):
        if not str(roles.get(role, '')).endswith('/smol'):
            problems.append('omp modelRoles.%s must point at the smol combo '
                            '(got %r)' % (role, roles.get(role)))
    threshold = (cfg.get('compaction') or {}).get('thresholdPercent')
    if not isinstance(threshold, int) or threshold > 70:
        problems.append('omp compaction.thresholdPercent must be <= 70 '
                        '(got %r) - models declare contextWindow 200000, so '
                        'a higher percentage compacts far too late'
                        % (threshold,))

# omp models.yml: every 9router entry needs a real window and a cost block, or
# omp cannot reason about price and compacts on a fictional ceiling.
try:
    models = yaml.safe_load(open('omp/.omp/agent/models.yml')) or {}
    entries = ((models.get('providers') or {}).get('9router') or {}).get('models') or []
    bad_window = [m.get('id') for m in entries if m.get('contextWindow') != 200000]
    bad_cost = [m.get('id') for m in entries if not m.get('cost')]
    if bad_window:
        problems.append('models.yml 9router entries with contextWindow != 200000: %s'
                        % ', '.join(map(str, bad_window)))
    if bad_cost:
        problems.append('models.yml 9router entries without a cost block: %s'
                        % ', '.join(map(str, bad_cost)))
except Exception as e:
    problems.append('omp models.yml unreadable: %s' % e)

print('; '.join(problems))
" 2>/dev/null)" && [ -z "$inv" ]; then
        pass "harness invariants hold (RTK, combo order, smol roles, catalog, windows)"
    else
        fail "harness invariants: ${inv:-unparseable}"
    fi
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

    # dsh profile configs must NOT be stowed: dsh writes them with
    # writeFileAtomic, which renames a temp file over the target, so a symlink
    # would be replaced by a regular file on the first settings save and the
    # link silently lost. install.sh seeds them instead. The exclude lives in
    # dsh/.stow-local-ignore, whose patterns are matched against a "/"-prefixed
    # package-relative path — get that wrong and the pattern silently matches
    # nothing, so assert the outcome rather than trusting the file.
    if out="$(stow --simulate -t "$scratch" --no-folding -v dsh 2>&1)"; then
        if printf '%s\n' "$out" | grep -q 'LINK: \.dsh/profiles'; then
            fail "stow dsh links .dsh/profiles — it must be seeded, not linked"
        else
            pass "dsh profiles are excluded from stow"
        fi
    else
        fail "stow dsh simulation failed: $out"
    fi
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
