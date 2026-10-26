# GenOffice

[GenOffice](https://genoffice.ai) — a desktop document suite (docx, xlsx, pptx,
pdf) with an in-app AI agent and a CLI (`genoffice`) that exposes the same
engines, including a 32-tool MCP server. Installed from the vendor DMG at
`/Applications/GenOffice.app`; `genoffice` is symlinked into `/usr/local/bin` by
the app's own `install-cli`.

### Install

The app is the only source of the CLI — `genoffice mcp` and the skill both run
the copy inside the bundle, so nothing works without it installed first.

```bash
# 1. App (macOS; Windows/Linux installers on the same Releases page)
#    The cask is the same build as the .dmg, but requires macOS >= 12;
#    the DMG itself supports macOS 11+.
brew install --cask genoffice        # or: download the .dmg from
                                     # https://github.com/genspark-ai/genoffice/releases/latest
open -a GenOffice                    # first launch clears Gatekeeper, creates
                                     # ~/Library/Application Support/GenOffice/

# 2. CLI on PATH — the app writes the symlink itself
genoffice install-cli                # -> /usr/local/bin/genoffice (or ~/.local/bin)
genoffice --version
```

The CLI lives at `/Applications/GenOffice.app/Contents/Resources/cli/genoffice`
and is a self-contained bundle (no Node runtime needed). Every MCP config here
points at that absolute path rather than the PATH name, because an agent
launched from a GUI or a fresh shell may not have `/usr/local/bin` in scope.

### MCP Registration

```bash
genoffice mcp list                   # which agents have it registered
genoffice mcp install <agent|all>    # writes the stdio entry for you
genoffice skill install <agent|all>  # optional: the docx/pptx op reference
```

`mcp install` knows Claude Code, Codex, Cursor, Gemini CLI, Copilot CLI,
OpenCode and Windsurf. This repo registers the same server by hand for omp,
Pi and dsh, which the command does not cover — see the MCP Servers
table in the OMP section.

`status: "stale"` in `mcp list --json` does **not** mean broken: it fires when
the entry's `command`/`args` differ from the launcher the CLI would write
(here, `~/.claude.json` omits the `type: "stdio"` key that `mcp install`
adds). It still counts as registered.

### Linux / Headless Caveat

`render`, `convert` to PDF and `create_pdf` start a hidden Electron process, so
a server without a display needs `xvfb-run` and the app installed. Everything
else (`docs_*`, `sheet_*`, `slides_*`, `pdf_read`, `merge`) runs without a
window.

### Nothing Is Synced — Deliberately

GenOffice has no stow package and no tracked config. Its settings live under
`~/Library/Application Support/GenOffice/` (`ai-settings.json`, `app-settings.json`,
`control.json`, Chromium caches) and `ai-settings.json` holds a **plaintext API
key**, so it stays machine-local exactly like `~/.pencil/agent-auth`.

### AI Provider

The in-app agent rides the same 9router gateway as every other harness, on the
`coder` combo. `ai-settings.json`:

```json
{
  "provider": "custom",
  "providers": {
    "custom": {
      "apiKey": "<NINEROUTER_API_KEY value>",
      "model": "coder",
      "baseUrl": "https://ai.workofekajaya.com/v1",
      "profile": { "api": "openai-compatible" }
    }
  },
  "gskToolsEnabled": true,
  "maxOutputTokens": 32768
}
```

Two details make this work and are easy to get wrong:

- **`provider` must be `"custom"`**, not `"genspark"`. `activeProvider()` falls
  back to Genspark whenever the selected provider is missing a model, a base
  URL, or a key — so a half-filled entry silently reverts to the signed-out
  default.
- **The key must be written into the file.** GenOffice resolves
  `profile.apiKeyEnv` from the app's own `process.env`, and an app launched from
  Finder/Dock inherits none of your shell environment. There is no
  `!command` form here (unlike Pen), so the literal key is the only option —
  which is why this file is machine-local.

`maxOutputTokens` is clamped to 1024–131072 on read; 32768 matches the default.

**Any 9router model works, not just `coder`** — the custom provider is a plain
OpenAI-compatible client and the model string goes onto the wire unvalidated.
Verified in-app on `coder`, `advisor` and `designer` (all returned text).

**The model dropdown can come back empty — that is not a wiring failure.**
GenOffice populates Settings → Model from `GET /v1/models` through
`listCustomModels`, which caps the call at 5 s (`REQUEST_TIMEOUT_MS$1`) and
swallows the abort into `emptyCatalog()`. 9router generates its 453-entry
catalog per request and answers in 2.7–6.6 s, so the call times out roughly
half the time (measured 2 of 4 probes returning 0 at 5002/5004 ms). Consequences:

- The saved `model` is unaffected — turns keep working while the picker is blank.
- With an empty list the UI renders a free-text `input` instead of the
  `Dropdown`, so you can type any model id by hand.
- A previously selected model is never dropped from a successful list; the UI
  prepends it when it is missing.

Diagnose an empty picker by timing the endpoint, not by re-checking the key:

```bash
curl -sS -o /dev/null -w '%{time_total}s\n' \
  https://ai.workofekajaya.com/v1/models \
  -H "Authorization: Bearer $NINEROUTER_API_KEY"
```

Over ~5 s means the picker will be flaky; caching the catalog gateway-side is
the real fix.

**Cloud features are separate.** Search (Serper, Serply, Tavily, Parallel, Exa,
Firecrawl, Keenable — 9router is not one), image generation and media analysis
each need their own key in the `media`/`search` blocks and stay `false` in
`genoffice capabilities --json` until configured.

### MCP

`genoffice mcp` is a stdio MCP server over all 32 CLI commands (`docs_read`,
`docs_apply`, `sheet_read`, `slides_*`, `pdf_read`, `render`, `merge`, …). It is
registered in omp, OpenCode, Claude Code, Pi and dsh — see the MCP
Servers table in the OMP section. Pi needs the `pi-mcp-extension` package
(`pi install npm:pi-mcp-extension`) because Pi 0.87 has no built-in MCP. Its
entry uses `"lifecycle": "lazy"` (the schema's default), so the server only
starts on `/mcp:start` — the right posture for a macOS-only binary that does not
exist on most hosts.

### Validation

```bash
genoffice capabilities --json          # provider plumbing; "app" is always available
genoffice mcp list --json              # which agents have genoffice registered
claude mcp list | grep genoffice       # ✔ Connected
opencode mcp list | grep -A1 genoffice # ✓ connected
pi mcp list                            # pi 1.x; the 0.87 build has no such command
```

The `capabilities` command reports only the **cloud** features (search, image
search/generation, media analysis) — all of which need a separate provider key
and are unconfigured here. It does not report the chat provider, so "configured:
app" is the expected output even when `coder` is wired correctly.

See [AGENTS.md](../AGENTS.md) for the repo-wide conventions.
