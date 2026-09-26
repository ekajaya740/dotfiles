#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# jev/install.sh — reproducible install of the Jev toolchain
#
# Jev tooling is installed by each app into its own machine-local dirs
# (~/.omp/plugins, ~/.hermes/plugins, ~/.config/omp-jev, …), so none of it
# can be stowed. This script reproduces the installs on a new device.
#
# Idempotent: safe to re-run. Everything is reversible (see --uninstall notes).
#
#   ./install.sh            install everything applicable to this machine
#   ./install.sh --check    show what would happen, change nothing
#
# All Jev backends here use OpenRouter (OPENROUTER_API_KEY), not a TypeSafe
# key. No key is ever written to disk by this script.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

CHECK=false
[[ "${1:-}" == "--check" ]] && CHECK=true

info() { printf '\033[1;34m[INFO]\033[0m  %s\n' "$*"; }
ok()   { printf '\033[1;32m[ OK ]\033[0m  %s\n' "$*"; }
warn() { printf '\033[1;33m[WARN]\033[0m  %s\n' "$*"; }
has()  { command -v "$1" >/dev/null 2>&1; }
run()  { if $CHECK; then echo "  [dry-run] $*"; else "$@"; fi; }

# Homebrew/Node bins are absent from GUI app PATHs; make them available here.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.bun/bin:$HOME/.local/bin:$PATH"

# ── backend check ────────────────────────────────────────────
check_backend() {
    if [[ -n "${OPENROUTER_API_KEY:-}" ]]; then
        ok "OPENROUTER_API_KEY set — Jev will use OpenRouter"
    else
        warn "OPENROUTER_API_KEY not set — Jev tools fail closed until it is."
        warn "  add it to ~/.zshenv.local (see dotfiles AGENTS.md)"
    fi
}

# ── omp: omp-jev (routing) ───────────────────────────────────
install_omp_jev() {
    has omp || { warn "omp not installed — skipping omp-jev"; return 0; }
    info "omp-jev (Jev routing for omp)"
    if $CHECK; then
        echo "  [dry-run] omp install omp-jev"
    else
        omp install omp-jev 2>&1 | sed 's/^/  /' || { warn "omp-jev install failed"; return 0; }
    fi

    # Point it at OpenRouter instead of the TypeSafe default.
    local cfg="$HOME/.config/omp-jev/config.json"
    if $CHECK; then
        echo "  [dry-run] write $cfg (endpoint=openrouter, apiKeyEnv=OPENROUTER_API_KEY)"
        return 0
    fi
    if [[ -f "$cfg" ]]; then
        ok "  config exists — left alone ($cfg)"
    else
        local example="$HOME/.omp/plugins/node_modules/omp-jev/examples/jev.json"
        mkdir -p "$(dirname "$cfg")"
        if [[ -f "$example" ]]; then
            python3 - "$example" "$cfg" <<'PY'
import json, sys
cfg = json.load(open(sys.argv[1]))
cfg["client"] = {
    "endpoint": "https://openrouter.ai/api/alpha/decisions",
    "model": "typesafe/jev-1.13",
    "apiKeyEnv": "OPENROUTER_API_KEY",
    "timeoutMs": 5000,
}
json.dump(cfg, open(sys.argv[2], "w"), indent=2)
PY
            ok "  wrote $cfg (OpenRouter)"
        else
            warn "  template not found: $example"
        fi
    fi
}

# ── omp: omp-jev-compaction (context reduction) ──────────────
install_omp_compaction() {
    has omp || return 0
    info "omp-jev-compaction (Jev-scored context reduction)"
    local src="$HOME/.omp/plugins-local/omp-jev-compaction"

    # The npm/git installs fail validation because dist/ is not built, so clone
    # and build locally, then link.
    if [[ ! -d "$src/.git" ]]; then
        run mkdir -p "$HOME/.omp/plugins-local"
        run git clone --depth 1 https://github.com/jerryfane/omp-jev-compaction "$src"
    fi
    if [[ ! -f "$src/dist/hook.js" ]]; then
        info "  building dist/ (tsc)"
        $CHECK || (cd "$src" && npm install --no-audit --no-fund >/dev/null 2>&1 && npx tsc >/dev/null 2>&1)
    fi
    if [[ ! -f "$src/dist/hook.js" && ! $CHECK ]]; then
        warn "  build failed — skipping"; return 0
    fi

    run omp plugin install "$src"
    # Jev backend: OpenRouter (not TypeSafe).
    run omp plugin config set omp-jev-compaction provider openrouter
    ok "  compaction installed, provider=openrouter"
}

# ── hermes: hermes-jev-skills ────────────────────────────────
install_hermes_jev() {
    local home="${HERMES_HOME:-$HOME/.hermes}"
    [[ -d "$home" ]] || { warn "no Hermes at $home — skipping"; return 0; }
    info "hermes-jev-skills (routing, memory, skills, browser/computer use)"
    local src="$HOME/.cache/hermes-jev-skills"
    if [[ ! -d "$src/.git" ]]; then
        run git clone --depth 1 https://github.com/kerpopule/hermes-jev-skills "$src"
    fi
    # install.py detects Hermes/Claude Code/Codex and installs for each.
    # It never asks for or prints an API key; `jev setup-key` is separate.
    if $CHECK; then
        (cd "$src" 2>/dev/null && python3 install.py --check 2>&1 | sed 's/^/  /') || echo "  [dry-run] python3 install.py"
    else
        (cd "$src" && python3 install.py 2>&1 | tail -3 | sed 's/^/  /')
        ok "  installed (restart the Hermes gateway to load it)"
    fi
}

# ── MCP server: jev-mcp ──────────────────────────────────────
# Registered per-harness (omp mcp.json, opencode.json, hermes config.yaml).
# Needs a Node-capable PATH; the Pen app (PATH=/usr/bin:/bin) cannot spawn npx.
install_jev_mcp_note() {
    info "jev-mcp (MCP tools) — register per harness"
    cat <<'EOF'
  Add to each MCP config:
    omp      ~/.omp/agent/mcp.json        (mcpServers)
    opencode ~/.config/opencode/opencode.json (mcp)
    hermes   ~/.hermes/config.yaml        (mcp_servers)
    pen      ~/.pencil/models.json        — NOT applicable (MCP is separate;
             and Pen's PATH cannot resolve npx)
  Server entry:
    command: npx   args: ["-y", "@jkudish/jev-mcp"]
    env:     OPENROUTER_API_KEY  (JEV_PROVIDER=openrouter)
  Skipped here: these configs are stow-managed in this repo, edit them there.
EOF
}

# ── pi-warden (pi + omp) ─────────────────────────────────────
install_pi_warden() {
    info "pi-warden (guardrails for Pi and omp)"

    # pi: requires Pi >= 0.85 (older versions fail or misbehave).
    if has pi; then
        local ver; ver="$(pi --version 2>&1 | head -1 | tr -d '[:space:]')"
        if [[ -z "$ver" || "$(printf '%s\n0.85\n' "$ver" | sort -V | head -1)" != "0.85" ]]; then
            warn "  pi ${ver:-unknown} < 0.85 required — upgrade: brew upgrade pi-coding-agent"
        else
            run pi install npm:pi-warden
            ok "  pi: pi-warden installed"
        fi
    else
        warn "  pi not installed — skipping pi side"
    fi

    # omp: the same npm package, installed through omp's own plugin manager.
    if has omp; then
        run omp plugin install npm:pi-warden
        ok "  omp: pi-warden installed"
    fi

    # Judgments use OpenRouter (not TypeSafe), matching the other Jev tools.
    # Without this the plugin defaults to the typesafe backend and fails closed.
    # pi-warden resolves its config via PI_CODING_AGENT_DIR, falling back to
    # ~/.pi/agent. omp sets that variable to its own agent dir
    # (PI_CODING_AGENT_DIR=<omp agentDir>), so write BOTH locations rather than
    # assuming which one a given host picks up.
    local cfg_dirs=("$HOME/.pi/agent/pi-warden" "$HOME/.omp/agent/pi-warden")
    if $CHECK; then
        echo "  [dry-run] set typesafeBackend=openrouter in: ${cfg_dirs[*]}"
    else
        python3 - "${cfg_dirs[@]}" <<'PY'
import json, sys, pathlib
for raw in sys.argv[1:]:
    p = pathlib.Path(raw) / "config.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    cfg = {}
    if p.exists():
        try:
            cfg = json.loads(p.read_text())
        except Exception:
            cfg = {}
    cfg["typesafeBackend"] = "openrouter"
    p.write_text(json.dumps(cfg, indent=2) + "\n")
    print("    wrote", p)
PY
    fi
    info "  enable in-session with /warden enable (judgments are off until then)"
}

# ── main ─────────────────────────────────────────────────────
info "Jev toolchain install ($([[ $CHECK == true ]] && echo 'check' || echo 'apply'))"
check_backend
install_omp_jev
install_omp_compaction
install_hermes_jev
install_pi_warden
install_jev_mcp_note

echo
ok "done. verify with: jev doctor"
