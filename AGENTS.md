# Agent Instructions

This document provides guidelines for AI agents and automation tools working with this dotfiles repository.

## Quick Reference

- **Source of truth**: Edit files in this repo only, never resolved paths under `$HOME`
- **Symlink management**: Use `stow` for creating/managing symlinks
- **Validation**: Always run checks before and after changes
 **Keybindings**: See [KEYBINDINGS.md](./KEYBINDINGS.md) for custom shortcuts

```
~/dotfiles/
├── nvim/.config/nvim/          → ~/.config/nvim
├── tmux/.tmux.conf             → ~/.tmux.conf
├── opencode/.config/opencode/  → ~/.config/opencode/
├── omp/.omp/agent/            → ~/.omp/agent (config + models only)
├── pi/.pi/agent/extensions/   → ~/.pi/agent/extensions (pi-notify-pp)
├── omarchy/.config/hypr/       → ~/.config/hypr (hyprland + related configs)
├── agent/.agent/commands/     → ~/.agent/commands (custom omp commands)
├── claude/.claude/            → ~/.claude (deployed by claude/install.sh, not stowed)
└── pen/.pencil/models.json    → ~/.pencil/models.json (9router custom provider)
```

### Config Categories

Every package here is one of two kinds. Know which before editing — they have
different sync rules and different failure modes.

| Category | Packages | What it is | Sync rule |
|----------|----------|------------|-----------|
| **Agent harness** | `omp`, `opencode`, `hermes`, `pen`, `pi`, `agent`, `claude` | Config for an AI coding/chat harness | Stow the *config only*. The harness's own state (sessions, DBs, plugins, caches) stays machine-local — see each section below. |
| **Other** | `nvim`, `tmux`, `zsh`, `vim`, `omarchy` | Editor, multiplexer, shell, WM | Straight stow; these own their whole config dir. |

Harness packages that share a directory with app state must be stowed with
`--no-folding` (`omp`, `pen`), or the app writes its state into the repo — see
**Safety Rules**. `claude` is different again: it is not stowed at all (the
claude CLI rewrites `settings.json`), but deployed by `claude/install.sh`.

**Harness state is never synced.** Sessions, credentials, plugin installs and
caches live in machine-local dirs (`~/.omp/plugins`, `~/.hermes/plugins`,
`~/.pi/agent/npm`, `~/.claude`, …). Reproduce them with `bootstrap.sh`, which
runs `jev/install.sh`; never commit them.

## Workflow

### Making Changes

1. Edit files in `~/dotfiles/` only
2. Changes are immediately reflected via symlinks
3. Validate before committing

### Validation Checklist

```bash
# Syntax validation
jq empty opencode/.config/opencode/*.json

# Verify symlinks
ls -l ~/.config/nvim ~/.tmux.conf ~/.config/opencode/ ~/.omp/agent/

# Test configs
nvim --headless -c 'quit' 2>/dev/null && echo "nvim OK"
tmux -f ~/.tmux.conf list-keys 2>/dev/null | head -1
```

### Restowing

If symlinks break or need refresh:

```bash
cd ~/dotfiles
stow -D nvim tmux opencode omp agent pi hermes omarchy pen  # Unstow
stow nvim tmux opencode omp agent pi hermes omarchy pen     # Restow

# Pen keeps app state (sessions/, agent-auth) in ~/.pencil — stow it without
# folding, or ~/.pencil would become a symlink into the repo.
stow --no-folding pen
```

## Safety Rules

- **Never** commit secrets, tokens, or credentials
- **Never** modify files directly in `~/.config/` or `~`
- **This repo is shared across machines** — never put host-specific behaviour in
  shared config. A command embedded in config (e.g. an `apiKey`) must work on
  every host; prefer `zsh -c` over `zsh -lc`, because `-l` also reads
  `~/.zprofile` (`exec startx` on Arch VT1, `ssh-agent`).
- **API keys: never inline a literal.** Reference an env var (`$VAR` or a
  `!command`) so the secret stays in `zsh/.zshenv.local` (gitignored) or the
  app's own credential store. Bare names like `"VAR"` are literals, not
  references, and fail with 401.
- **Symlinks point one way: repo → `$HOME`.** Never make a tracked directory the
  parent of machine state. If an app writes state into a stowed dir (see `pen`),
  stow with `--no-folding` and add a `.gitignore` rule for the state files.
- Preserve existing user model/provider configurations unless explicitly asked
- Keep changes minimal and consistent with existing style
- When editing `bootstrap.sh` or `sync-dotfiles.sh`, keep them consistent: any
  package, `--no-folding` exception, or validation added to one belongs in both.
- Test changes in headless mode when possible


## Common Tasks

### Update OpenCode config

```bash
# Edit in repo
vim ~/dotfiles/opencode/.config/opencode/oh-my-opencode.json

# Validate
jq empty ~/dotfiles/opencode/.config/opencode/oh-my-opencode.json

# Changes apply immediately (symlinked)
```

### Add new stow package

```bash
# Create structure
mkdir -p ~/dotfiles/<package>/.config/<package>

# Add files
# Then stow
cd ~/dotfiles && stow <package>
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Broken symlinks | `stow -D <pkg> && stow <pkg>` |
| Conflicts with existing files | Backup first: `mv ~/.config/<pkg> ~/.config/<pkg>.bak` |
| Permission denied | Ensure repo is in `~` not system paths |

## oh-my-pi (OMP)

[oh-my-pi](https://github.com/can1357/oh-my-pi) — AI coding agent for the terminal. CLI command: `omp`.

### Config Files Managed in This Repo

- `omp/.omp/agent/config.yml` → `~/.omp/agent/config.yml` (settings, model roles)
- `omp/.omp/agent/models.yml` → `~/.omp/agent/models.yml` (custom providers & models)
- `omp/.omp/agent/mcp.json` → `~/.omp/agent/mcp.json` (MCP servers)

### NOT Managed (machine-local state)

- `~/.omp/agent/agent.db` (credentials DB)
- `~/.omp/agent/sessions/` (session history)
- `~/.omp/agent/memories/` (autonomous memory)
- `~/.omp/logs/` (debug logs)

### Model Configuration

All AI model traffic goes through the **9router** gateway (`https://ai.workofekajaya.com/v1`, an OpenAI-compatible proxy). Models are declared in `omp/.omp/agent/models.yml` and referenced as `9router/<model-id>`.

| Role | Model | Purpose |
|------|-------|---------|
| default | `9router/cost-efficient` | Primary agent |
| smol | `9router/cost-efficient` | Quick/light tasks |
| plan | `9router/cost-efficient` | Planning & architecture |
| commit | `9router/cost-efficient` | Commit generation |
| designer | `9router/designer:auto` | Design / UI work |
| advisor | `9router/advisor:high` | Advice / review |
| vision | `9router/ollama-cloud/gemma4:31b:auto` | Image-capable fallback |

Set `NINEROUTER_API_KEY` in your shell environment (`~/.zshenv.local`) to authenticate against the gateway.

### Update OMP config

```bash
# Edit in repo
vim ~/dotfiles/omp/.omp/agent/config.yml
vim ~/dotfiles/omp/.omp/agent/models.yml

# Validate YAML syntax
python3 -c "import yaml; yaml.safe_load(open('omp/.omp/agent/config.yml')); print('config.yml OK')"
python3 -c "import yaml; yaml.safe_load(open('omp/.omp/agent/models.yml')); print('models.yml OK')"

# Changes apply immediately (symlinked)
# Restart omp to reload: /config reload or restart session
```

### Stowing

Run `omp` at least once before stowing to create `~/.omp/agent/` with local state:

```bash
cd ~/dotfiles
stow omp agent
```

### MCP Servers

Configured in `omp/.omp/agent/mcp.json` (oMP), `opencode/.config/opencode/opencode.json` (OpenCode), `hermes/.hermes/config.yaml` (`mcp_servers:`), and `claude/.claude/mcp.json.template` (Claude Code — merged into `~/.claude.json` by `claude/install.sh`). The `jev` MCP server is registered by the `jev-router` Claude plugin instead.

| Server | Type | Command | Purpose |
|--------|------|---------|---------|
| lightpanda | stdio | `lightpanda mcp` | Native headless browser MCP — markdown, semantic tree, structured data, JS eval |
| grep_app | stdio | `bunx -y @modelcontextprotocol/server-github` | GitHub API access |
| pencil | stdio | `/Applications/Pen.app/Contents/Resources/app.asar.unpacked/out/mcp-server-darwin-arm64 --app desktop --agent <name>` | pen.dev design files — read/modify `.pen` via MCP |
| codebase-memory-mcp | stdio | `~/.local/bin/codebase-memory-mcp` | Code intelligence knowledge graph — search, trace, architecture, impact analysis |

**codebase-memory-mcp** is a high-performance code intelligence MCP server. It indexes codebases into a persistent knowledge graph for fast structural queries. Installed at `~/.local/bin/codebase-memory-mcp`. Configured with the native binary path (not `npx -y`) in omp/opencode/hermes MCP configs and `~/.claude.json`. The `npx -y codebase-memory-mcp` fallback is intentionally replaced because the native binary must match the shared coordination daemon version.


### Custom Commands (`.agent/commands/`)

User-level custom omp commands that dispatch directly to a specific agent, bypassing the default model's interpretation.

| Command | File | Effect |
|---------|------|--------|
| `/designer` | `~/.agent/commands/designer.md` | Forwards your prompt to the `designer` agent with zero deviation |

Usage: `/designer <your design prompt>` — the designer agent runs on `9router/designer:auto` (configured via `modelRoles.designer`).

The `$@` placeholder in the command body passes your inline arguments straight to the agent assignment. The body is rigid — the main model has no room to paraphrase or re-route.

#### Adding new commands

Create `agent/.agent/commands/<name>.md` with YAML frontmatter:
```markdown
---
name: <name>
description: <description shown in help>
---

Use the task tool with the following parameters — do not paraphrase or change the agent name:
- agent: "<agent-name>"
- tasks: [{ id: "main", description: "<desc>", assignment: "$@" }]
```

Then stow: `stow agent`.

### Orchestrator Mode (default agent routing)

The default omp agent is configured as an **orchestrator** — it routes specialized work to sub-agents via the `task` tool rather than doing everything itself.

| Route | Agent | Enables |
|-------|-------|---------|
| UI/UX design | `designer` | Re-enabled from `task.disabledAgents` |
| Codebase exploration | `explore` | Re-enabled from `task.disabledAgents` |
| Code review | `reviewer` | Always available (`/review` or task) |
| Commit/push | CLI `omp commit` | CLI tool, not a task agent |
| Vision analysis | `inspect_image` tool | Routes to `modelRoles.vision` automatically |

The default omp agent reads the orchestrator instructions and delegates:
- Design/UI work → spawn `designer` agent
- Exploration → spawn `explore` agent
- Simple ops → do directly (reading files, running commands)

To add an agent to the routing table, remove it from `task.disabledAgents` in `config.yml` and add a row to the routing table.

## Pen (pen.dev)

[Pen](https://pen.dev) is a design tool whose built-in agent runs on a bundled
[pi](https://github.com/earendil-works/pi) runtime. Custom OpenAI-compatible
providers are declared in `~/.pencil/models.json`, which is **stowed from this
repo** so the 9router provider syncs across machines.

### Config Files Managed in This Repo

- `pen/.pencil/models.json` → `~/.pencil/models.json` (9router custom provider)

### Not Synced (machine-local state and secrets)

Only `models.json` is tracked. The rest of `~/.pencil` is deliberately excluded:

| Path | Why it stays local |
|------|--------------------|
| `session-desktop.json` | **Live account bearer token** |
| `agent-auth` | API keys pasted via Pen's UI (`0600`) |
| `config.json`, `models-store.json` | Window bounds, workspace folders, login state |
| `documents/`, `backup/`, `previews/`, `apps/`, `socket/`, `skills/` | Design documents and runtime state |

`~/Library/Application Support/Pen/config.json` is electron-store `DesktopConfig`.
It has no model/provider fields and its schema includes `claudeApiKey`,
`codexApiKey`, `geminiApiKey`, and `cursorApiKey`, which Pen's UI writes there
once entered — so it is **not** stowed either.

### Stowing

`~/.pencil` also holds the state above, so the package **must** be stowed with
`--no-folding`. Plain `stow pen` on a machine without an existing `~/.pencil`
would replace the directory with a symlink into the repo, causing Pen to write
its state there.

```bash
cd ~/dotfiles
stow --no-folding pen
```

`bootstrap.sh` and `sync-dotfiles.sh` handle this automatically (`pen` is in
`STOW_NO_FOLDING`). A `.stow-local-ignore` cannot guard this, because the fold
happens at the directory level.

### Provider Configuration

The provider is exposed to Pen as `9router`, over the same gateway omp and
OpenCode use (`https://ai.workofekajaya.com/v1`). Combo models mirror the ones
declared for the other harnesses:

| # | Model ID | Purpose |
|---|----------|---------|
| 1 | `designer` | Design / UI work — **default** |
| 2 | `coder` | Primary coding work |
| 3 | `advisor` | Advice / review |
| 4 | `personal-chat` | General conversation |
| 5 | `sfw-coder` | Text-only safe coder |
| 6 | `sfw-advisor` | Text-only safe advisor |

Select them in Pen's agent model picker (they appear under the **9Router**
provider). Pen's own `config.json` has no model fields — this provider is
separate from Pen's CLI integrations (`claudeCodeCLI`, `openCodeCLI`, …), which
read their own configs.

**The default model is the first entry in `models`.** Pen derives it as
`supportedModels[0].id`; there is no config field for it. Reorder the array to
change the default — `designer` is listed first so Pen opens on it. Reordering
does not affect the other harnesses, which select models independently.

### API Key

Pen launched from the Dock/Finder does **not** inherit shell environment
variables, so a plain `$NINEROUTER_API_KEY` reference would fail there. The key
is resolved through a shell command at request time instead:

```json
"apiKey": "!zsh -c 'printenv NINEROUTER_API_KEY'"
```

This keeps the secret in `~/.zshenv.local` and out of the repo.

**Use `zsh -c`, not `zsh -lc` — the zsh config is shared across machines.**
`.zshenv` is read for every zsh invocation and sources `.zshenv.local`, so `-c`
resolves the key. `-lc` would additionally read `~/.zprofile`, which runs
`exec startx` on Arch VT1 and spawns `ssh-agent`. A login shell inside a Pen
request must not trigger those host-specific side effects.

A key pasted through Pen's UI takes precedence and is stored in
`~/.pencil/agent-auth`, not in `models.json`. Pen's Settings reads only
`agent-auth`, so it can show the key as unset while the command form is working.

### Validation

```bash
jq empty pen/.pencil/models.json
```

## Jev Toolchain

[Jev](https://docs.typesafe.ai) is TypeSafe's **decision** model — it answers
typed questions (pick one, score, yes/no) and never writes prose. Several tools
use it to make cheap per-turn judgments: model routing, context compaction,
guardrails. It is *not* a chat model, so nothing here goes in `models.yml`.

**Backend: OpenRouter, not TypeSafe.** `TYPESAFE_API_KEY` is not set on this
machine; every Jev tool is configured to use `OPENROUTER_API_KEY` instead
(`typesafe/jev-1.13` via `openrouter.ai/api/alpha/decisions`). Set that key in
`~/.zshenv.local`. A tool left on its default backend fails closed without a
TypeSafe key.

### What Is Synced vs Machine-Local

| Part | Location | Synced? |
|------|----------|---------|
| MCP server entry (`jev-mcp`) | `omp/.omp/agent/mcp.json`, `opencode/.config/opencode/opencode.json`, `hermes/.hermes/config.yaml` | ✅ stowed |
| Everything else — CLI, plugins, node_modules | `~/.omp/plugins`, `~/.hermes/plugins`, `~/.local/bin/jev`, `~/.pi/agent/npm` | ❌ machine-local |

`bootstrap.sh` runs **`jev/install.sh`** (idempotent, `--check` for a dry run)
to reproduce the machine-local half on a new device.

### Components

| Component | Harnesses | Notes |
|-----------|-----------|-------|
| `hermes-jev-skills` | hermes | Routing, memory, skill selection, browser/computer use. Installs a `jev` CLI + `~/.hermes/plugins/hermes-{jev,handoff}`. |
| `omp-jev` | omp | Jev routing; config at `~/.config/omp-jev/config.json` (pointed at OpenRouter). |
| `omp-jev-compaction` | omp | Jev-scored context reduction. Built from source into `~/.omp/plugins-local/`, linked with `omp plugin install <path>`. |
| `pi-warden` | pi, omp | Guardrails. `typesafeBackend: openrouter` in `~/.pi/agent/pi-warden/config.json` — one file covers both, since pi-warden's `userConfigPath()` hardcodes `~/.pi/agent`. |

### Pen Cannot Run jev-mcp

Pen launches with `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, so it cannot resolve
`npx` (the same reason `spawn npm ENOENT` appears in `~/Library/Logs/Pen/main.log`).
Jev MCP is registered in **omp, opencode and hermes only**. Pen gets Jev only if
a compiled binary ships.

### Consent and Defaults

- `pi-warden`: judgments are **off** until `/warden enable` (it shows a
  disclosure naming `openrouter.ai`). Offline guards work without any key.
- `omp-jev`: dispatcher ships `enabled: true`.
- `omp-jev-compaction`: continuous context reduction is **on** by default
  (`context: true`) and sends conversation state to the decision endpoint.

### Validation

```bash
~/.local/bin/jev doctor          # key present, endpoint reachable, routing config
bash jev/install.sh --check      # what a fresh device would install
```

## Claude Code

[Claude Code](https://code.claude.com) — Anthropic's terminal coding agent. CLI command: `claude`.

### Config Files Managed in This Repo

- `claude/.claude/settings.json` → merged into `~/.claude/settings.json` by `claude/install.sh`
- `claude/.claude/skills/jev-router/` → symlinked to `~/.claude/skills/jev-router` by `claude/install.sh`
- `claude/.claude/mcp.json.template` → merged into `~/.claude.json` by `claude/install.sh` (user-scope MCP servers)

### NOT Managed (machine-local state)

`~/.claude` holds auth and runtime state: `.credentials.json`, `history.jsonl`,
`sessions/`, `projects/`, `plugins/`, `cache/`, `daemon/`, …. Only
`settings.json` and `skills/jev-router` are managed, and **neither is stowed** —
the claude CLI rewrites `settings.json` in place (which would break a symlink),
and a plugin must be a self-contained directory. `claude/install.sh` merges
`settings.json` into `~/.claude/settings.json` and symlinks the plugin. `~/.claude.json`
is not tracked either — it holds the OAuth account and per-project state, so its
`mcpServers` block is merged from the template.

### Model Configuration

Claude Code speaks the Anthropic Messages API. 9router serves it at
`https://ai.workofekajaya.com/v1/messages`, so Claude Code rides the same 9router
combos as the other harnesses — no separate provider. `settings.json` sets:

| Setting | Value | Purpose |
|---------|-------|---------|
| `ANTHROPIC_BASE_URL` | `https://ai.workofekajaya.com` | 9router gateway |
| `ANTHROPIC_MODEL` | `coder` | primary model (combo) |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | `coder` | standard work |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | `advisor` | hardest work |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | `ollama-cloud/glm-5.3-flash` | cheap/fast jobs |
| `ANTHROPIC_SMALL_FAST_MODEL` | `ollama-cloud/glm-5.3-flash` | background jobs |
| `CLAUDE_CODE_MAX_CONTEXT_TOKENS` | `1000000` | combos expose a 1M window |

The 9router key is **not** in the file — a settings `env` value is not expanded,
so a literal `$NINEROUTER_API_KEY` would be sent as-is. `apiKeyHelper` runs
`zsh -c 'printenv NINEROUTER_API_KEY'` per request instead, reading the key from
`~/.zshenv.local`. `CLAUDE_CODE_MAX_CONTEXT_TOKENS` also silences the
`unrecognized_model` notice (the combo names are not in Claude's model catalog).

### jev-router (Jev subagent routing)

`claude/.claude/skills/jev-router/` is a Claude Code plugin (auto-loads from the
skills dir as `jev-router@skills-dir`). It carries:

- a `PreToolUse` hook on `Task|Agent` that asks TypeSafe Jev — through 9router
  SystemOne (`POST /v1/systemone`, model `openrouter/typesafe/jev-1.13`) — which
  agent type and model a subagent needs;
- the `jev` MCP server (`@jkudish/jev-mcp`, `JEV_PROVIDER=compatible`) at the
  same SystemOne endpoint, so `/jev` tools work without native routing.

The hook makes one change only: when Jev picks a read-only lookup **and**
`Explore`/`haiku` at ≥ 0.8 confidence, the call is rewritten to the `Explore`
agent on the `haiku` alias. Everything else runs as Claude set it up, and any Jev
error or timeout leaves the call untouched (fail-open). Downward only — a call
already on `haiku` is never touched, and the model is never raised.

| Env var | Default | Effect |
|---------|---------|--------|
| `JEV_ROUTER_MODE` | `apply` | `advise` observes (status line) without rewriting |
| `JEV_ROUTER_AGENT_MIN` / `JEV_ROUTER_MODEL_MIN` | `0.8` | confidence gates |
| `JEV_ROUTER_DEBUG` | off | log the pick to stderr |
| `JEV_API_BASE_URL` / `JEV_MCP_MODEL` | 9router | override the Jev backend |

### Deploying

`claude/` is not a stow package — deploy it, like `jev/`:

```bash
cd ~/dotfiles
bash claude/install.sh   # merge settings.json + MCP servers, link the plugin
```

Run `claude` once first so `~/.claude/` exists. `/reload-plugins` (or a new
session) loads `jev-router`.

### Validation

```bash
jq empty claude/.claude/settings.json
node --check claude/.claude/skills/jev-router/hooks/route.mjs
claude plugin list | grep jev-router
```

## Pi Coding Agent Extensions

### pi-notify-pp

[Pi Notify++](https://github.com/kim0/pi-notify-pp) sends native terminal notifications when the Pi agent completes a turn. Uses OSC 777 escape sequences (supported by Ghostty, iTerm2, rxvt-unicode, Kitty).

**Location**: `pi/.pi/agent/extensions/pi-notify-pp/` → `~/.pi/agent/extensions/pi-notify-pp/`

Features:
- **Smart status**: ✅ success, ❌ error, ⚠️ truncated
- **Time-aware**: Duration shown only for tasks >1 minute
- **Contextual metadata**: Tool count, last action, error details, session name
- **Click-to-focus**: Clicking the notification brings the terminal to foreground

**Stowing**:
```bash
cd ~/dotfiles && stow pi
```

**Editing**: Modify `index.ts` in the repo to change icons, thresholds, or formatting. Changes apply immediately via symlink.

## Neovim Plugin Notes

- **Mason**: Use `mason-org/mason.nvim` (renamed from `williamboman/mason.nvim`)
- **LSP**: LazyVim's built-in LSP stack is used (nvim-lspconfig, mason-lspconfig, nvim-cmp)
- **Java**: Uses `nvim-java/nvim-java` (wraps jdtls with code actions, DAP, Spring Boot, test runner); NOT managed via Mason/lspconfig

## rest.nvim HTTP Client

This dotfiles includes [rest.nvim](https://github.com/rest-nvim/rest.nvim) - a powerful HTTP client for Neovim. It allows you to run HTTP requests from within the editor using `.http` files.

### Basic Usage

1. **Create an HTTP file**: Create a file with `.http` extension (e.g., `api_test.http`)
2. **Write requests**: Use the Intellij HTTP client spec format
3. **Run requests**: Place cursor on a request and run `:Rest run` or press `<leader>rr`

### HTTP File Syntax Example

```http
### GET request
GET https://api.example.com/users

### POST request with body
POST https://api.example.com/users
Content-Type: application/json

{
  "name": "John Doe",
  "email": "john@example.com"
}

### Request with query parameters
GET https://api.example.com/search?q=query&page=1

### Request with custom headers
GET https://api.example.com/protected
Authorization: Bearer your-token-here
```

### Available Commands

| Command | Description |
|---------|-------------|
| `:Rest run` | Run request under cursor |
| `:Rest run {name}` | Run request by name (e.g., `### name`) |
| `:Rest last` | Run last request |
| `:Rest open` | Open result pane |
| `:Rest env select` | Select `.env` file for variables |
| `:Rest env show` | Show current env file |
| `:Telescope rest select_env` | Pick env file via Telescope |

### Keybindings

| Key | Action |
|-----|--------|
| `<leader>rr` | Run request under cursor |
| `<leader>rl` | Run last request |
| `<leader>ro` | Open result pane |

### Environment Variables

rest.nvim supports `.env` files for storing variables:

1. Create a `.env` file in your project root
2. Define variables: `API_BASE_URL=https://api.example.com`
3. Use in requests: `GET {{API_BASE_URL}}/users`
4. Run `:Rest env select` to choose the env file

### Lua Scripting in Requests

```http
GET http://localhost:8000/api

# @lang=lua
> {%
local json = vim.json.decode(response.body)
print(json.message)
%}
```

### Dependencies

- `curl` (system package)
- `jq` and `tidy` (for response formatting)

### Language Servers (auto-installed via Mason)

| Language | LSP | Formatters/Linters |
|----------|-----|-------------------|
| TypeScript/JavaScript | `vtsls`, `typescript-language-server` | `prettierd`, `eslint_d` |
| Vue | `vue-language-server` (volar) | `prettierd` |
| Svelte | `svelte-language-server` | `prettierd` |
| Astro | `astro-language-server` | `prettierd` |
| React/JSX | Built-in via TS LSP | `prettierd`, `eslint_d` |
| Tailwind CSS | `tailwindcss-language-server` | - |
| Java | `jdtls` (via nvim-java) | - |
| Python | `pyright` | `ruff` |
| Go | `gopls` | `goimports`, `gofumpt` |
| Rust | `rust-analyzer` | `rustfmt` |
| C/C++ | `clangd` | `clang-format` |
| C# | `omnisharp` | - |
| PHP (Laravel/WordPress) | `intelephense` | `php-cs-fixer`, `phpcs` |
| Ruby | `ruby-lsp` | `rubocop` |
| Dart/Flutter | `dartls` | - |
| Zig | `zls` | `zigfmt` |
| Lua | `lua-language-server` | `stylua` |
| Bash/Shell | `bash-language-server` | `shfmt`, `shellcheck` |
| Docker | `dockerfile-language-server`, `docker-compose-language-service` | - |
| Prisma | `prisma-language-server` | - |
| GraphQL | `graphql-language-service-cli` | - |
| JSON/YAML | `json-lsp`, `yaml-language-server` | `prettierd` |
| HTML/CSS | `html-lsp`, `css-lsp` | `prettierd` |

@RTK.md

## Ponytail — Lazy Senior Dev Mode

You are a lazy senior developer. Lazy means efficient, not careless. The best code is the code never written.

Before writing any code, stop at the first rung that holds:

1. Does this need to be built at all? (YAGNI)
2. Does it already exist in this codebase? Reuse it, don't rewrite.
3. Does the standard library already do this? Use it.
4. Does a native platform feature cover it? Use it.
5. Does an already-installed dependency solve it? Use it.
6. Can this be one line? Make it one line.
7. Only then: write the minimum code that works.

Rules:
- No abstractions that weren't explicitly requested.
- No new dependency if it can be avoided.
- No boilerplate nobody asked for.
- Deletion over addition. Boring over clever. Fewest files possible.
- Shortest working diff wins, but only once you understand the problem.
- Mark intentional simplifications with a `ponytail:` comment.
- Not lazy about: understanding the problem, input validation, error handling, security, accessibility.


## Machine-Specific Setup

After stowing, run these on each new machine:

```bash
# Set the 9router gateway key (all AI model traffic)
export NINEROUTER_API_KEY="your-key"   # add to ~/.zshenv.local
```

The pi-notify-pp extension path is already in `omp/.omp/agent/config.yml` as `~/dotfiles/...`
(portable — omp expands `~`, but NOT `$HOME`; do not rewrite it with `omp config set`).

Or run `bootstrap.sh` which handles all of the above automatically.
