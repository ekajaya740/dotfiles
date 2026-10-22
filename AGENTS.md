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
├── zsh/.zshenv .zprofile .zshrc .p10k.zsh → ~/.zshenv, ~/.zprofile, ~/.zshrc, ~/.p10k.zsh
├── vim/.vimrc, vim/.vim/       → ~/.vimrc, ~/.vim
├── opencode/.config/opencode/  → ~/.config/opencode/
├── omp/.omp/agent/             → ~/.omp/agent (config + models only; --no-folding)
├── pi/.pi/agent/extensions/    → ~/.pi/agent/extensions (pi-notify-pp)
├── hermes/.hermes/             → ~/.hermes (config + memories)
├── pen/.pencil/models.json     → ~/.pencil/models.json (--no-folding)
├── dsh/.dsh/                   → ~/.dsh (DeepSeek Harness home patch; --no-folding)
├── omarchy/.config/hypr/       → ~/.config/hypr (Hyprland/Omarchy; Arch-only, stow manually)
├── claude/.claude/             → ~/.claude (deployed by claude/install.sh, NOT stowed)
├── jev/                        → no config; jev/install.sh installs the Jev toolchain
├── 9router/                    → no config; export.sh refreshes config-export.json
├── hypr-lua/omarchy4/          → no config; Omarchy 4 Lua port (not stowed)
├── scripts/validate.sh         → the check suite; CI runs this exact script
├── scripts/release_dotfiles.py → tags CHANGELOG.md versions (see CI and Releases)
├── CHANGELOG.md                → drives releases; newest version first
└── .github/workflows/          → validate.yml + release.yml
```

### Config Categories

Every package here is one of three kinds. Know which before editing — they have
different sync rules and different failure modes.

| Category | Packages | What it is | Sync rule |
|----------|----------|------------|-----------|
| **Agent harness** (stowed) | `omp`, `opencode`, `hermes`, `pen`, `pi`, `dsh` | Config for an AI coding/chat harness | Stow the *config only*. The harness's own state (sessions, DBs, plugins, caches) stays machine-local — see each section below. |
| **Other** (stowed) | `nvim`, `tmux`, `zsh`, `vim`, `omarchy` | Editor, multiplexer, shell, WM | Straight stow; these own their whole config dir. |
| **Deployed / not stowed** | `claude`, `jev`, `9router`, `hypr-lua` | Installer scripts, config backups, unshipped ports | Never stowed. Run the package's own script (`claude/install.sh`, `jev/install.sh`) or refresh tooling (`9router/export.sh`). |

`omarchy` is stowed by hand on Arch/Omarchy hosts only — it is deliberately
absent from `ALL_PACKAGES` in `scripts/packages.sh`, because `~/.config/hypr` is
meaningless on macOS. That file is the single source of truth for the package
list, the group shortcuts, and the `--no-folding` rule; `bootstrap.sh`,
`sync-dotfiles.sh` and `scripts/validate.sh` all source it, so there is no
second list to keep in sync.

Harness packages that share a directory with app state must be stowed with
`--no-folding` (`omp`, `pen`, `dsh`), or the app writes its state into the repo
— see `STOW_NO_FOLDING` in `scripts/packages.sh`.

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

**Keep the docs in sync — update them in the same commit.** Any change that
alters what this repo *contains* must update the docs that describe it:

| Change | Update |
|--------|--------|
| Package added/removed/renamed, or stow flags changed | `ALL_PACKAGES` / `STOW_NO_FOLDING` in **`scripts/packages.sh`** (the only place they live), plus the `AGENTS.md` tree + Config Categories and `README.md` Repository Layout |
| `modelRoles` in `omp/.omp/agent/config.yml` | the model table in the OMP section |
| Config file path or filename | every section and layout listing that names it |
| New harness / tool / section | a `##` section in `AGENTS.md` and a line in `README.md` |
| A check added to `scripts/validate.sh` | the [Validation Checklist](#validation-checklist) here, and the CI section below |

Never leave a doc describing a package, role, or path that no longer exists —
stale docs are worse than none, because agents act on them.

### Validation Checklist

Everything the repo checks lives in one script, and CI runs the same script, so
a green local run means a green pipeline:

```bash
./scripts/validate.sh    # or: make validate
```

It runs, fail-closed:

1. **ShellCheck** on every tracked `*.sh` (`--severity=warning`).
2. **JSON** parse of every tracked `*.json` / `*.json.template`.
3. **YAML** parse of every tracked `*.yml` / `*.yaml` (workflows excluded).
4. **`stow --simulate`** of all nine packages into a scratch target — proves
   every tracked file still maps to a real destination, without touching `$HOME`.
5. **`release_dotfiles.py --check`**, which also validates `CHANGELOG.md`.

The severity is passed explicitly because older ShellCheck builds ignore
`severity` in `.shellcheckrc`, and a gate that silently reports nothing is worse
than no gate. Do not add `|| true` to any check here.

For spot checks:

```bash
# Verify symlinks resolve
ls -l ~/.config/nvim ~/.tmux.conf ~/.config/opencode/ ~/.omp/agent/

# Test configs
nvim --headless -c 'quit' 2>/dev/null && echo "nvim OK"
tmux -f ~/.tmux.conf list-keys 2>/dev/null | head -1
```

### Restowing

If symlinks break or need refresh, prefer the scripts, which apply the correct
`--no-folding` flags and keep the package lists in one place:

```bash
cd ~/dotfiles
./sync-dotfiles.sh --sync-only              # restow every package
./sync-dotfiles.sh --sync-only --harness    # restow only the harness configs
./sync-dotfiles.sh --sync-only --only omp,hermes
```

By hand, the flags are on you — `omp`, `pen` and `dsh` must not be folded:

```bash
cd ~/dotfiles
stow nvim tmux zsh vim opencode hermes pi   # packages that fold safely
stow --no-folding omp pen dsh               # packages holding app state

# Arch/Omarchy hosts only — ~/.config/hypr does not exist on macOS.
stow omarchy
```

### Selecting Packages

`bootstrap.sh` and `sync-dotfiles.sh` can stow a subset instead of everything.
The names and groups come from `scripts/packages.sh`, so a typo fails loudly
rather than quietly stowing nothing.

```bash
./bootstrap.sh --harness --skip-deps --sync-only   # relink harness configs only
./bootstrap.sh --only omp,hermes                   # arbitrary subset
./bootstrap.sh --editor --shell                    # nvim vim zsh tmux
./bootstrap.sh --all                               # the default
```

Groups: `harness` (`omp opencode hermes pen pi dsh`), `editor` (`nvim vim`),
`shell` (`zsh tmux`). `--sync-only` skips toolchain setup (mise, oh-my-zsh,
p10k, fzf) and only restows; `--skip-deps` additionally skips system packages.
`--only` and a group flag may be combined, and duplicates are collapsed.

Note that `--only` narrows the **unstow** pass too, so selecting a subset never
unlinks the packages you left out.

## CI and Releases

Two workflows, both in `.github/workflows/`:

| Workflow | Trigger | Does |
|----------|---------|------|
| `validate.yml` | every push to `main` and every PR | installs the tools, runs `scripts/validate.sh` |
| `release.yml` | push to `main` touching `CHANGELOG.md` (or manual dispatch on `main`) | validates, then tags and publishes |

Both jobs install `shellcheck`, `jq`, `stow`, and PyYAML before running the
script — `validate.sh` fails closed when a tool is missing, so a job that
skipped the install step would fail rather than silently skip checks.

### Releases

Releases are driven by `CHANGELOG.md`; there is no separate version file and no
manual tagging step.

1. Add a `## [x.y.z] - YYYY-MM-DD` section at the **top** of `CHANGELOG.md`,
   above the current newest release, with the notes for this release.
2. Merge to `main`.

`release.yml` then runs `scripts/release_dotfiles.py --tag`, which compares that
version against existing tags and, if untagged, creates `dotfiles-vX.Y.Z`
annotated with the changelog section, pushes it, and opens a GitHub release
whose body is the tag message.

Rules the script enforces — each fails closed rather than skipping:

- Versions are `x.y.z`, and the newest heading must be **first** in the file.
- A version may appear only once, and must have notes under it.
- An existing tag means "already released": re-running is a no-op.

Local equivalents:

```bash
make release-check   # what would be released? writes nothing
python3 scripts/release_dotfiles.py --tag   # create the tag locally
```

Never hand-edit a version heading to a value that is already tagged, and never
reorder released sections — the script reads the file top-down and refuses to
guess.

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
  parent of machine state. If an app writes state into a stowed dir, stow with
  `--no-folding` and add a `.gitignore` rule for the state files. `omp` and
  `pen` are both in this category, and their `STOW_NO_FOLDING` lists must stay
  in sync across `bootstrap.sh`, `sync-dotfiles.sh`, and `scripts/validate.sh`.
  Without `--no-folding`, `stow omp` folds all of `~/.omp` into a single
  symlink, and the agent's databases and sessions land in the repo.
- Preserve existing user model/provider configurations unless explicitly asked
- Keep changes minimal and consistent with existing style
- When editing `bootstrap.sh` or `sync-dotfiles.sh`, keep them consistent: any
  package, `--no-folding` exception, or validation added to one belongs in both.
- Test changes in headless mode when possible

## Common Tasks

### Update OpenCode config

```bash
# Edit in repo
vim ~/dotfiles/opencode/.config/opencode/oh-my-openagent.json

# Validate
jq empty ~/dotfiles/opencode/.config/opencode/*.json

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

**Exception: `dsh` is not on 9router by default.** It ships pointing at
DeepSeek's official API with `DEEPSEEK_API_KEY`, per the "direct key first"
choice — see the dsh *Model Routing and Gateways* section for the 9router
recipe. Every other harness (omp, opencode, hermes, pen) rides 9router.

| Role | Model | Purpose |
|------|-------|---------|
| default | `9router/coder` | Primary agent |
| smol | `9router/coder` | Quick/light tasks |
| tiny | `9router/coder` | Smallest/cheapest jobs |
| plan | `9router/coder` | Planning & architecture |
| commit | `9router/coder` | Commit generation |
| slow | `9router/coder` | Deep reasoning |
| task | `9router/coder` | Subagent dispatch |
| advisor | `9router/advisor:high` | Advice / review |
| vision | `9router/coder` | Image-capable fallback |

**This table mirrors `modelRoles` in `omp/.omp/agent/config.yml` — that file is the
source of truth.** Update this table in the same commit as any `modelRoles`
change, or it drifts (it previously listed `cost-efficient` and a `designer` role
that no longer exist).

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
stow omp
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


### Orchestrator Mode (default agent routing)

The default omp agent is configured as an **orchestrator** — it routes specialized work to sub-agents via the `task` tool rather than doing everything itself.

| Route | Agent | Enables |
|-------|-------|---------|
| Codebase exploration | `explore` | Re-enabled from `task.disabledAgents` |
| Code review | `reviewer` | Always available (`/review` or task) |
| Commit/push | CLI `omp commit` | CLI tool, not a task agent |
| Vision analysis | `inspect_image` tool | Routes to `modelRoles.vision` automatically |

The default omp agent reads the orchestrator instructions and delegates:
- Exploration → spawn `explore` agent
- Simple ops → do directly (reading files, running commands)

To add an agent to the routing table, enable it via `task.disabledAgents` in
`config.yml` (omit or remove the agent from that list) and add a row above.

## Hermes

[Hermes](https://github.com/earendil-works/hermes) — a gateway-capable AI agent
with Discord/Telegram/Slack front ends, a dashboard, TTS/STT, memory, and cron.
Config lives at `~/.hermes/config.yaml`.

### Config Files Managed in This Repo

- `hermes/.hermes/config.yaml` → `~/.hermes/config.yaml` (v49 schema — models, toolsets, MCP servers, platforms)
- `hermes/.hermes/AGENTS.md` → `~/.hermes/AGENTS.md` (agent instructions)
- `hermes/.hermes/SOUL.md` → `~/.hermes/SOUL.md` (persona)
- `hermes/.hermes/CLAUDE.md` → `~/.hermes/CLAUDE.md` (Claude Code interop)
- `hermes/.hermes/memories/MEMORY.md`, `USER.md` → `~/.hermes/memories/` (curated memory)

### NOT Managed (machine-local state)

Sessions, plugin installs (`~/.hermes/plugins`), credentials, and the Jev
toolchain are machine-local. Reproduce them with `bootstrap.sh` (which runs
`jev/install.sh`).

### Model Configuration

Hermes reaches the same 9router combos through a **local** endpoint
(`http://127.0.0.1:20128/v1`) rather than the public gateway — the key still
comes from `NINEROUTER_API_KEY`:

| Setting | Value |
|---------|-------|
| `model.provider` / `model.default` | `9router` / `personal-chat` |
| `model.base_url` | `http://127.0.0.1:20128/v1` |
| `model.key_env` | `NINEROUTER_API_KEY` |
| `providers.9router` | same local base_url + key env |
| `fallback_providers` | 3 entries |

A second provider, `shiteru` (`SHITERU_API_KEY`), is declared alongside it.

### MCP Servers

Configured under `mcp_servers:` in `config.yaml`: `hevy` (`${HEVY_API_KEY}`),
`arxiv`, `pencil`, `codebase-memory-mcp` (native binary), and `jev`
(`JEV_PROVIDER=openrouter`). `investment_vault` is present but `enabled: false`.

### Gateway and Platforms

Hermes runs a gateway with a dashboard at `https://hermes.workofekajaya.com`
and a Discord front end enabled (`platforms.discord`, home channel
`#ai-logs`). Cron, kanban dispatch, and TTS/STT (Edge voices by default) are
configured in the same file.

### Validation

```bash
python3 -c "import yaml; yaml.safe_load(open('hermes/.hermes/config.yaml')); print('config.yaml OK')"
```

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

## DeepSeek Harness (dsh)

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) is
DeepSeek's open-source agent harness — "everything is a plugin", built on the
[Cordis](https://github.com/cordiverse/cordis) plugin framework. It is the
intended long-term replacement for `omp` and `hermes` here, so it is stowed
alongside them rather than added as an ad-hoc install.

### Config Files Managed in This Repo

- `dsh/.dsh/cordis.patch.yml` → `~/.dsh/cordis.patch.yml` (home-level patch)

### Layer Order

`dsh` composes its effective config over an empty root, applying layers
lowest-priority first. Later layers win per row:

1. each bundle patch named in the profile manifest's `dsh.profile.bundles`
2. the profile's own `cordis.patch.yml`
3. the **home-level** `$DSH_HOME/cordis.patch.yml` — the file this repo syncs,
   applied to every profile, so it is the right place for machine-wide settings
4. each `--patch <path>` overlay, in argv order

**A patch replaces the targeted row's complete `config` value — it does not
deep-merge keys.** A partial patch silently drops every key it does not restate.

### Why Only the Home Patch Is Synced

`dsh` auto-initializes the shipped profiles (`web`, `headless`, `sdk`,
`sdk-minimal`, `acp`) from templates on first use, and the launcher claims the
profile directory **exclusively** — it rejects a target whose directory already
exists. Pre-creating `profiles/web/` in this repo would therefore make
`dsh web` fail on a fresh machine, so this package deliberately ships only the
home-level patch. Profile-specific overlays are machine-local; add one with
`dsh plugin --profile <name> add <package>`.

### Not Synced (machine-local state and secrets)

| Path | Why it stays local |
|------|--------------------|
| `.credentials.yaml` | **Provider API keys** |
| `logs/` | Startup diagnostics that can echo credential values |
| `profiles/` | pnpm-managed; holds `node_modules/` and lockfiles |

The root `.gitignore` ignores everything under `dsh/.dsh/` except
`cordis.patch.yml`, so a fold or a stray `git add` cannot leak these.

### Stowing

`~/.dsh` also holds the state above, so the package **must** be stowed with
`--no-folding`. Plain `stow dsh` on a machine without an existing `~/.dsh` would
replace the directory with a symlink into the repo and let `dsh` write its
credentials there.

```bash
cd ~/dotfiles
stow --no-folding dsh
```

`bootstrap.sh` and `sync-dotfiles.sh` handle this automatically (`dsh` is in
`STOW_NO_FOLDING`).

### Installing Plugins

Plugins are managed per profile through pnpm, so they are machine-local and
never tracked here:

```bash
dsh plugin --profile web add <package>     # initializes the profile if missing
dsh plugin --profile web remove <package>
```

The CLI ships `@deepseek-ai/dsh-mcp-client` for patch layers, but **no MCP
server is enabled by default**, because each server command is trusted
executable code outside the agent sandbox.

### Multi-Agent Swarm (in-process)

The swarm is **first-party and already mounted by `dsh-base`** — nothing extra
to install. The native equivalent of omp's `task` tool:

| Row | Package | Role |
|-----|---------|------|
| `subagent` | `@deepseek-ai/dsh-subagent` | Registry seam (`ctx.subagents`) |
| `subagent-spawn-in-process` | `@deepseek-ai/dsh-subagent-spawn-in-process` | Fresh child agent, provider name `spawn` |
| `subagent-fork-in-process` | `@deepseek-ai/dsh-subagent-fork-in-process` | Child seeded from a prefix of the parent context, provider name `fork` |
| `tool-subagent` | `@deepseek-ai/dsh-tool-subagent` | Model-facing `subagent` tool (backgroundMode `continuable`) |
| `tool-subagent-fork` | `@deepseek-ai/dsh-tool-subagent` | Same tool bound to the `fork` provider |
| `tool-subagent-control` | `@deepseek-ai/dsh-tool-subagent-control` | `send_message`, `interrupt_agent`, `list_agents` |

Row ids are version-specific — these are from the pinned `0.2.0-rc.2` bundle,
where `subagent-spawn`/`subagent-fork` and `telemetry-otel` were renamed. An
unmatched patch target is reported on stderr, so re-verify against
`@deepseek-ai/dsh-base`'s `cordis.patch.yml` whenever `DSH_VERSION` moves.

Fork vs spawn is the useful distinction: **fork** inherits the parent's context
prefix (for follow-on work that needs the conversation), **spawn** starts clean
(for independent tasks). That mirrors omp routing exploration to a fresh
sub-agent.

**No Codex or Claude Code backend is involved, and none needs disabling.**
Earlier dsh releases mounted `subagent-codex` and `subagent-claude-code`
product providers; the pinned release has dropped them, so the swarm is
in-process by default. Do **not** re-add patch rows for those ids — they are
unmatched targets in this version and would warn on every boot.

**Per-subagent model routing is first-party** — the omp `modelRoles` analogue
needs no plugin. The shipped preset mounts the delegation tool with
`modelSelectionSettings: true`:

```yaml
- id: tool-subagent
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: spawn
    toolName: subagent
    modelSelectionSettings: true      # exposes provider/model/reasoning_effort
    backgroundMode: continuable
```

That setting makes the tool expose provider/model/reasoning-effort selection to
the delegating model plus a `list_subagent_models` tool, and it is a Web
Settings toggle (row `subagent-model-selection-settings`). So where omp pins
static roles in `modelRoles`, dsh lets the orchestrator choose per delegation.

### Multi-Agent Kanban

Hermes' kanban is a board *plus* a dispatcher: `auto_decompose`, a 60s
`dispatch_interval_seconds` tick, and claim/assign across workers. dsh has no
single first-party equivalent; it splits across two pieces:

| Concern | dsh |
|---------|-----|
| Board with claim/assign across agents | `@dsh-suite/plugin-team-board` (community) |
| Decompose + run orchestration | `@deepseek-ai/dsh-tool-workflow` (first-party) |
| Workers | the in-process swarm above |

`@dsh-suite/plugin-team-board` materializes its state as a Cordis **service key
`ctx.teamBoard`** (not a module global), so the board is visible across sessions
and subagents, and exposes `task_create` / `task_claim` / `task_update` /
`task_list` / `task_delete` as model tools. It persists to
`$DSH_HOME/team-board/board.json`, which is the source of truth across restarts
(the session journal does not survive a process restart). A visual panel lives
at Settings → Plugins → Team Board.

**Verify before relying on it.** In the `web` profile the model-facing tools are
owned by the **agent preset**, not the host plane: the web bundle disables the
host copies of `tool-subagent`, `tool-subagent-fork`, `tool-subagent-control`,
`tool-subagent-list-agents` and `tool-workflow` (`disabled: true` in
`@deepseek-ai/dsh-web-app`'s `cordis.patch.yml`), and the preset's
`presets/standard.patch.yml` mounts its own. Each agent reads the merged catalog
its scope chain selects, so a profile-installed plugin registering into the
global layer *should* reach the agent — but a plugin that registers tools only
for the host plane may be invisible in a web session.

The check is one command, and it is worth running before building on this:

```bash
dsh plugin --profile web add @dsh-suite/plugin-team-board
dsh --profile web --dump-config | grep -A3 team-board   # is it mounted, and where?
# then in a web session: does the model actually have task_create/task_claim?
```

If the tools do not appear, the fallback is to copy the shipped preset and add
the rows there — preset edits are the supported route for changing what an
agent's model can call. The same caveat applies to **every** tool-providing
plugin in this setup, not just the board.

### Model Routing and Gateways

Two adapters ship, and they are for different jobs:

| Adapter | Route | API shape | Use when |
|---------|-------|-----------|----------|
| `@deepseek-ai/dsh-llm-deepseek` | `deepseek-official` | **Anthropic Messages** (`/v1/messages`) | Direct DeepSeek only |
| `@deepseek-ai/dsh-llm-pi-ai` | per-provider, from `providers` | pi-ai catalogs | **Multi-provider or OpenAI-compatible gateways** |

**The Messages detail matters.** `llm-deepseek` is not a chat-completions
client: its default root is `https://api.deepseek.com/anthropic` and model
requests append `/v1/messages`. That is exactly the shape 9router already
serves — see the Claude Code section below, where
`ANTHROPIC_BASE_URL=https://ai.workofekajaya.com` is paired with 9router's
`/v1/messages` endpoint. So the adapter fits the gateway without a translation
layer, and the adapter's rule that "an exact final `/v1` segment is reused"
lines up with that base URL.

Use the **public** gateway, not `127.0.0.1:20128`: the local endpoint only
exists on this Mac, so a remote `headless` box would fail with a connection
error. Point `baseURL` at `https://ai.workofekajaya.com` and let the adapter
append `/v1/messages`:

```yaml
- id: llm-deepseek
  config:
    apiKeyEnv: NINEROUTER_API_KEY
    baseURL: https://ai.workofekajaya.com
    models:                       # advisory catalog; ids pass through to the wire
      - id: coder
        name: coder
      - id: advisor
        name: advisor
```

The model ids mirror the combos already used by omp/hermes (`coder`,
`personal-chat`, `advisor:high`), and the adapter passes unlisted ids through
unchanged, so a catalog entry is only needed for GUI selection.

`dsh-llm-pi-ai` is the alternative, and the one built for "multiple pi-ai
providers, OpenAI-compatible gateways, or self-hosted servers" — reach for it
only if you later route several providers through dsh. Both can be mounted
together, since their route names do not collide.

The shipped default needs no patch at all: `llm-deepseek` points at DeepSeek's
official API using `DEEPSEEK_API_KEY` (exported from `~/.zshenv.local`).

**Per-subagent model choice** is separate from provider plumbing: the delegation
tool's `modelSelectionSettings: true` lets the orchestrator pick a model per
subagent (see the swarm section).

### Multi-Profile

dsh has native multi-profile support, and it is stronger than hermes' — the
profile is a real unit, and its *plugins* are per-profile:

```bash
dsh <name>                              # shorthand for: dsh --profile <name>
dsh plugin --profile <name> add <pkg>   # initializes the profile if missing
dsh --profile <name> --dump-config      # inspect the composed tree
```

This repo uses two: **`web`** (browser UI, the swarm + kanban surfaces) and
**`headless`** (one-shot CLI — `dsh --profile headless "run the tests"` — the
surface for scripted and remote work). There is no `cli` profile; the shipped
templates are `web`, `headless`, `sdk`, `sdk-minimal`, `acp`. To derive a custom
one:

```bash
dsh --profile mine --from-default-profile web
```

Profiles live at `$DSH_HOME/profiles/<name>/` and are pnpm projects holding
`node_modules/`. **They are machine-local and never synced** — which is why only
the home patch is tracked. Reproduce a profile on a new machine with
`dsh plugin --profile <name> add ...`.

### Telemetry: Three Egresses, Two Levers

dsh has **three independent outbound paths**, and they are not switched the same
way. Getting this wrong means believing you opted out when you did not.

| Egress | Payload | How to turn it off |
|--------|---------|--------------------|
| `session-log-deepseek` | `dsh_session_log` — unaccepted message/tool log suffixes, up to 8 MiB per request. **Carries message text.** | `enabled: false` in the home patch |
| `plugin-package-inventory-deepseek` | `dsh_plugin_packages` — active plugin/package inventory | `enabled: false` in the home patch |
| `session-telemetry-otel` | Releases a session-log prefix to OTLP, but **only after explicit user feedback** — `mode` defaults to `FEEDBACK_ONLY` and the bundle notes "ordinary activity never triggers capture" | **env var only** |

The first two default to `enabled: true` in `0.2.0-rc.2` — verified in the
packages' own declarations (`session-log-deepseek` declares
`enabled: Volatile<boolean>` "Defaults to true"; the inventory declares
`enabled?: boolean` "Defaults to true"). Both are config-controllable and are
switched off in `dsh/.dsh/cordis.patch.yml`. **`session-log-deepseek` is the
one that matters**: it rides every DeepSeek request, so it is the continuous
path and the one carrying message text.

The OTel row is **not** config-controllable. dsh composes its tree in code and
its own notes say the launchers patch the row disabled precisely because
*"config cannot disable a row"* — so `enabled: false` for it silently does
nothing. The lever is the environment:

```bash
export DSH_TELEMETRY_DISABLED=1   # any non-empty value, incl. '0'/'false'
```

Set in `zsh/.zshenv` (not `.local`, since it is not a secret) so the posture
follows the machine. `DSH_TELEMETRY_MODE=DISABLED` also works; `FULL` is
rejected.

Both levers are asserted in the dsh *Validation* section below, and the
patch-side half runs in CI via `scripts/validate.sh`.

A fourth path has **no switch at all**: every model and Files call carries
shared attribution, and model requests carry a stable anonymous user id
(`$DSH_HOME/.anonymous-user-id`; deleting that file resets the identity). It
rides the request to whichever endpoint serves it — DeepSeek's API or 9router —
so routing does not avoid it. Treat the opt-outs as covering content, not all
metadata.

**Scoping differs per egress, and this matters.** The two request-extension
contributions (`session-log-deepseek`, `plugin-package-inventory-deepseek`)
attach to *official DeepSeek* requests only. OTel is **not** scoped that way:
it exports "for all users and providers, including `deepseek-official`", so
routing dsh through 9router would not narrow it. None of them change what the
model sees — only what leaves the machine.

### Remote Access

The web profile binds loopback (`127.0.0.1:3080`) and dsh intentionally rejects
`--host 0.0.0.0`, because the agent has a shell. Remote access is therefore a
plugin decision, and the safe shape is identity-based rather than a public bind:

```bash
dsh plugin --profile web add github:TiantianFlow/dsh-tailscale-gateway
```

`dsh-tailscale-gateway` allowlists users from the `Tailscale-User-Login` header
that Tailscale Serve injects and keeps the upstream on loopback — no public
port. Alternatives seen in the catalog (`dsh-pocket`, `dsh-web-remote`) expose a
LAN or Cloudflare tunnel with token auth; prefer Tailscale where possible. A
plain SSH port-forward to loopback is the zero-plugin option.

### Installing and Pinning

`dsh` is pinned in `bootstrap.sh`'s mise block via the npm backend:

```bash
mise use -g npm:@deepseek-ai/dsh@0.2.0-rc.2   # DSH_VERSION overrides the pin
```

It is pinned rather than `@latest` on purpose: dsh is a developer preview that
ships compatibility-breaking changes, so bump `DSH_VERSION` deliberately.
Plugins are machine-local (see Multi-Profile), so the package set is reproduced
with `dsh plugin --profile <name> add`, not by this repo.

### Validation

`scripts/validate.sh` (and therefore CI) already covers the patch, so a local
run is the first check:

```bash
./scripts/validate.sh    # or: make validate
```

That asserts the patch parses, that its root is a list of rows, **and** that
both telemetry opt-out rows are still present with `enabled: false` — dropping
one silently re-enables an upload, so it is a hard failure rather than a note.

The OTel lever is env-only and cannot be asserted from the patch:

```bash
grep -q '^export DSH_TELEMETRY_DISABLED=' zsh/.zshenv && echo "otel opt-out OK"
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
- **Linting (JS/TS)**: `oxlint` runs as an LSP. It is registered through the
  modern `vim.lsp.config()` / `vim.lsp.enable()` API, **not** the `servers` table
  in `lsp.lua` — the legacy `lspconfig.configs.oxlint` shim still points at the
  removed `oxc_language_server` binary, while lspconfig's newer `lsp/oxlint.lua`
  drives `oxlint --lsp`, which is what Mason installs. `oxlint` is also in
  `mason.lua`'s `ensure_installed`.

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

## Agent Skills

Third-party skills (currently [`mattpocock/skills`](https://github.com/mattpocock/skills))
are installed into `.agents/skills/` and loaded by omp from there.

**Nothing about them is tracked in this repo.** Upstream is MIT, but vendoring
someone else's skills into this public repo is a redistribution we do not want,
so `.agents/skills/` is in `.gitignore` and the working tree keeps the files
while git ignores them. The install lock is not tracked here either — this repo
is dotfiles, not the skills collection.

### Where skills are actually managed

The skills collection lives in its own repo, [`ekajaya740/skills`](https://github.com/ekajaya740/skills)
(`~/skills`). It is the home for both first-party skills and downloaded ones,
and it is where the skills lock is tracked.

This is wired up through the CLI's own conventions:

- `~/.agents/skills` is a **symlink to `~/skills`**, so global installs land in
  the collection repo rather than in dotfiles.
- The global lock is `~/.agents/.skill-lock.json`, which is itself a **symlink
  to `~/skills/.skill-lock.json`**. The CLI writes with a plain `writeFile`, so
  it writes *through* the symlink — the lock stays tracked in the collection
  repo while the CLI sees it at the path it expects. Do not replace that
  symlink with a regular file; the two copies will drift.

The lock file *name* is scope-dependent: the global lock is `.skill-lock.json`,
while `npx skills add` run with a cwd inside a project writes `skills-lock.json`
at that project's root. Running `skills add` from `~/dotfiles` would drop a
`skills-lock.json` here and content into `.agents/skills/` — do it from
`~/skills` (or globally) instead.

### Installing and updating

```bash
# Update installed skills to their latest upstream versions
npx skills@latest update

# List what is installed, with sources
npx skills@latest list -g

# Claude Code uses its own managed plugin instead of the vendored copies
claude plugin update mattpocock-skills
```

The skill files themselves must never appear in this repo's `git status`; if
they do, the ignore rule has been lost.

### Notes

- Claude Code gets the same upstream skills through the
  `mattpocock-skills@mattpocock` plugin (`~/.claude/plugins/cache/`), pinned by
  `gitCommitSha` in `~/.claude/plugins/installed_plugins.json`. Installing both
  the plugin and the vendored copies leaves every skill duplicated — prefer one.
- `~/skills` also holds symlinks into Omarchy's package-owned skills
  (`/usr/share/omarchy/default/agents/skills/…`); those are not content, so do
  not expect them to carry a license file of their own.
