#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# claude/install.sh — deploy the Claude Code config that cannot be stowed.
#
# The claude/ package is NOT a GNU Stow package. Two Claude Code behaviours rule
# stow out for its config:
#
#   * `claude` rewrites ~/.claude/settings.json in place on plugin add/remove and
#     /config — it replaces the file, so a stow symlink is destroyed; and
#   * plugin directories must be self-contained, so a plugin assembled from
#     per-file symlinks is rejected ("path escapes plugin directory").
#
# So this package is deployed like jev/ — a script reproduces the machine
# wiring — rather than symlinked:
#
#   1. settings.json      → merged into ~/.claude/settings.json
#   2. mcp.json.template  → merged into ~/.claude.json (user-scope mcpServers)
#   3. skills/jev-router/ → symlinked to ~/.claude/skills/jev-router
#
# Merge semantics: the repo config wins for the keys it manages (env,
# apiKeyHelper, statusLine, mcpServers); the plugin maps are unioned with the
# live values winning, so plugins installed on this machine survive.
#
# Idempotent. Writes no secrets: the 9router key is read from the environment at
# request time via apiKeyHelper / ${NINEROUTOUT_API_KEY} interpolation.
#
#   ./install.sh            apply
#   ./install.sh --check    show what would change, change nothing
# ─────────────────────────────────────────────────────────────
set -euo pipefail

CHECK=false
[[ "${1:-}" == "--check" ]] && CHECK=true

info() { printf '\033[1;34m[INFO]\033[0m  %s\n' "$*"; }
ok()   { printf '\033[1;32m[ OK ]\033[0m  %s\n' "$*"; }
warn() { printf '\033[1;33m[WARN]\033[0m  %s\n' "$*"; }

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SETTINGS="$REPO_DIR/claude/.claude/settings.json"
MCP_TEMPLATE="$REPO_DIR/claude/.claude/mcp.json.template"
PLUGIN_SRC="$REPO_DIR/claude/.claude/skills/jev-router"
PLUGIN_LINK="$HOME/.claude/skills/jev-router"
LIVE_SETTINGS="$HOME/.claude/settings.json"
LIVE_CLAUDE_JSON="$HOME/.claude.json"

[[ -f "$SETTINGS" ]] || { warn "settings template not found: $SETTINGS"; exit 1; }
command -v python3 >/dev/null || { warn "python3 required"; exit 1; }

if $CHECK; then
    echo "  [dry-run] merge $SETTINGS -> $LIVE_SETTINGS"
    echo "  [dry-run] merge mcpServers from $MCP_TEMPLATE -> $LIVE_CLAUDE_JSON"
    echo "  [dry-run] ln -sfn $PLUGIN_SRC -> $PLUGIN_LINK"
    exit 0
fi

info "deploying Claude Code config"

# 1 + 2: settings and user-scope MCP.
python3 - "$SETTINGS" "$MCP_TEMPLATE" "$LIVE_SETTINGS" "$LIVE_CLAUDE_JSON" <<'PY'
import json, os, pathlib, sys

settings_path, mcp_path, live_settings_path, live_json_path = sys.argv[1:5]

def load(path, default):
    p = pathlib.Path(path)
    if not p.exists():
        return default
    try:
        return json.loads(p.read_text())
    except Exception as exc:
        sys.exit(f"{path} is not valid JSON ({exc}); not touching it")

def write(path, doc):
    pathlib.Path(path).write_text(json.dumps(doc, indent=2) + "\n")

template = load(settings_path, {})
live = load(live_settings_path, {})
if not isinstance(live, dict):
    live = {}
merged = {**live, **template}            # managed keys win
for key in ("enabledPlugins", "extraKnownMarketplaces"):
    merged[key] = {**(template.get(key) or {}), **(live.get(key) or {})}
os.makedirs(os.path.dirname(live_settings_path), exist_ok=True)
write(live_settings_path, merged)
print(f"    settings.json: {len(merged)} keys "
      f"(env {len(merged.get('env', {}))}, plugins {len(merged.get('enabledPlugins', {}))})")

wanted = (load(mcp_path, {}) or {}).get("mcpServers", {})
doc = load(live_json_path, {})
if not isinstance(doc, dict):
    sys.exit("~/.claude.json top level is not an object; not touching it")
servers = doc.get("mcpServers")
if not isinstance(servers, dict):
    servers = {}
added = [n for n in wanted if n not in servers]
updated = [n for n, e in wanted.items() if n in servers and servers[n] != e]
servers.update(wanted)
doc["mcpServers"] = servers
write(live_json_path, doc)
print(f"    mcpServers: +{added} ~{updated} ({len(servers)} total)")
PY

# 3: the jev-router plugin, as a folder symlink (a self-contained plugin dir).
mkdir -p "$(dirname "$PLUGIN_LINK")"
if [[ -L "$PLUGIN_LINK" && "$(readlink -f "$PLUGIN_LINK")" == "$(readlink -f "$PLUGIN_SRC")" ]]; then
    ok "jev-router plugin already linked"
elif [[ -e "$PLUGIN_LINK" && ! -L "$PLUGIN_LINK" ]]; then
    warn "$PLUGIN_LINK exists and is not a symlink — moving it aside"
    mv "$PLUGIN_LINK" "$PLUGIN_LINK.bak.$(date +%Y%m%d-%H%M%S)"
    ln -sfn "$PLUGIN_SRC" "$PLUGIN_LINK"
else
    ln -sfn "$PLUGIN_SRC" "$PLUGIN_LINK"
    ok "linked jev-router plugin"
fi

ok "Claude Code config deployed (settings.json + ~/.claude.json + jev-router)"
