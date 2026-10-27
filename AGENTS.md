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
├── pi/.pi/agent/               → ~/.pi/agent (mcp.json + extensions/pi-notify-pp)
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
| **Agent harness** (stowed) | `omp`, `opencode`, `pen`, `pi`, `dsh` | Config for an AI coding/chat harness | Stow the *config only*. The harness's own state (sessions, DBs, plugins, caches) stays machine-local — see each section below. |
| **Other** (stowed) | `nvim`, `tmux`, `zsh`, `vim`, `omarchy` | Editor, multiplexer, shell, WM | Straight stow; these own their whole config dir. |
| **Deployed / not stowed** | `claude`, `jev`, `9router`, `hypr-lua` | Installer scripts, config backups, unshipped ports | Never stowed. Run the package's own script (`claude/install.sh`, `jev/install.sh`) or refresh tooling (`9router/export.sh`). |

`omarchy` is stowed by hand on Arch/Omarchy hosts only — it is deliberately
absent from `ALL_PACKAGES` in `scripts/packages.sh`, because `~/.config/hypr` is
meaningless on macOS. That file is the single source of truth for the package
list, the group shortcuts, and the `--no-folding` rule; `bootstrap.sh`,
`sync-dotfiles.sh` and `scripts/validate.sh` all source it, so there is no
second list to keep in sync.

Harness packages that share a directory with app state must be stowed with
`--no-folding` (`omp`, `pen`, `dsh`, `pi`), or the app writes its state into the repo
— see `STOW_NO_FOLDING` in `scripts/packages.sh`.

**Safety Rules**. `claude` is different again: it is not stowed at all (the
claude CLI rewrites `settings.json`), but deployed by `claude/install.sh`.

**Harness state is never synced.** Sessions, credentials, plugin installs and
caches live in machine-local dirs (`~/.omp/plugins`, `~/.pi/agent/npm`,
`~/.claude`, …). Reproduce them with `bootstrap.sh`, which
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
4. **Harness invariants** — the settings that make the cheap path cheap, asserted
   by value rather than by shape: `rtkEnabled: true` and
   `comboStrategy: "fallback"` in `9router/config-export.json`, no
   `comboStrategies` entry naming a combo that does not exist and none still on
   the smart router, omp's seven
   `skills.enable*` flags all `false`, `modelRoles.smol`/`tiny` on the `smol`
   combo, `compaction.thresholdPercent <= 70`, and every `9router` entry in
   `models.yml` carrying `contextWindow: 200000` plus a `cost` block. Each of
   these has been off-by-default at least once and each fails silently, so a
   regression has to break the build rather than quietly re-add tokens to every
   request.
5. **`stow --simulate`** of all ten packages into a scratch target — proves
   every tracked file still maps to a real destination, without touching `$HOME`.
6. **`release_dotfiles.py --check`**, which also validates `CHANGELOG.md`.

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
./sync-dotfiles.sh --sync-only --only omp,dsh
```

By hand, the flags are on you — `omp`, `pen`, `dsh` and `pi` must not be folded:

```bash
cd ~/dotfiles
stow nvim tmux zsh vim opencode            # packages that fold safely
stow --no-folding omp pen dsh pi           # packages holding app state

# Arch/Omarchy hosts only — ~/.config/hypr does not exist on macOS.
stow omarchy
```

### Selecting Packages

`bootstrap.sh` and `sync-dotfiles.sh` can stow a subset instead of everything.
The names and groups come from `scripts/packages.sh`, so a typo fails loudly
rather than quietly stowing nothing.

```bash
./bootstrap.sh --harness --skip-deps --sync-only   # relink harness configs only
./bootstrap.sh --only omp,dsh                      # arbitrary subset
./bootstrap.sh --editor --shell                    # nvim vim zsh tmux
./bootstrap.sh --all                               # the default
```

Groups: `harness` (`omp opencode pen pi dsh`), `editor` (`nvim vim`),
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

`ai.workofekajaya.com` must resolve to the **public** address
`203.0.113.10`; it carried a `100.64.0.10` A record until 2026-10-26, which
has no public route, so every off-tailnet consumer of that base URL hung until
`ERR_CONNECTION_TIMED_OUT`. It and `9router.workofekajaya.com` serve the same
upstream (`127.0.0.1:20128`); keep the two vhosts in sync. Note that the app
binds `0.0.0.0:20128` despite the unit's `HOSTNAME=127.0.0.1`, so
`9router-firewall.service` (iptables `REJECT` on eth0, enabled) is the only
thing keeping that port off the internet. It is a system unit, so unlike the
vhosts it is **not** stowed; its tracked copy lives at
`9router/etc/systemd/system/9router-firewall.service` and must be re-installed
by hand:

```bash
sudo cp 9router/etc/systemd/system/9router-firewall.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now 9router-firewall
```

A rebuild that drops this unit reopens `0.0.0.0:20128` to the internet, because
the app ignores `HOSTNAME` and binds all interfaces.

**Exception: `dsh` is not on 9router by default.** It ships pointing at
DeepSeek's official API with `DEEPSEEK_API_KEY`, per the "direct key first"
choice — see the dsh *Model Routing and Gateways* section for the 9router
recipe. Every other harness (omp, opencode, pen) rides 9router.

| Role | Model | Purpose |
|------|-------|---------|
| default | `9router/coder` | Primary agent |
| smol | `9router/smol` | Quick/light tasks |
| tiny | `9router/smol` | Smallest/cheapest jobs |
| plan | `9router/coder` | Planning & architecture |
| commit | `9router/coder` | Commit generation |
| slow | `9router/coder` | Deep reasoning |
| task | `9router/coder` | Subagent dispatch |
| advisor | `9router/advisor` | Advice / review |
| vision | `9router/coder` | Image-capable fallback |

**This table mirrors `modelRoles` in `omp/.omp/agent/config.yml` — that file is the
source of truth.** Update this table in the same commit as any `modelRoles`
change, or it drifts (it previously listed `cost-efficient` and a `designer` role
that no longer exist).

Set `NINEROUTER_API_KEY` in your shell environment (`~/.zshenv.local`) to authenticate against the gateway.

**Cheap/auxiliary slots in every other harness point at the same `smol` combo.**

| Harness | Setting | Value |
|---------|---------|-------|
| OpenCode | `model` / `small_model` | `9router/coder` / `9router/smol` |
| Pen | `models[].id` = `smol` (last entry) | `smol` |

Claude Code is deliberately **not** in that table: it runs against Anthropic's
own API with its own login, so it has no 9router combo to point at.

The `smol` combo lives in the 9router `combos` table, not in any harness file, so
there is no per-harness model list to keep in sync — but a harness that names a
combo 9router does not have fails at request time with `No active credentials
for provider: openai`, which is why the dead `cost-efficient` /
`combo-profill-*` entries are gone from `models.yml` and `opencode.json`.

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

Configured in `omp/.omp/agent/mcp.json` (oMP), `opencode/.config/opencode/opencode.json` (OpenCode), `pi/.pi/agent/mcp.json` (Pi — read by the `pi-mcp-extension`), `dsh/.dsh/cordis.patch.yml` (dsh — an `@deepseek-ai/dsh-mcp-client` row), and `claude/.claude/mcp.json.template` (Claude Code — merged into `~/.claude.json` by `claude/install.sh`). The `jev` MCP server is registered by the `jev-router` Claude plugin instead.

| Server | Type | Command | Purpose |
|--------|------|---------|---------|
| lightpanda | stdio | `lightpanda mcp` | Native headless browser MCP — markdown, semantic tree, structured data, JS eval |
| grep_app | stdio | `bunx -y @modelcontextprotocol/server-github` | GitHub API access |
| codebase-memory-mcp | stdio | `codebase-memory-mcp` (PATH; `mise use -g npm:codebase-memory-mcp`) | Code intelligence knowledge graph — search, trace, architecture, impact analysis |
| genoffice | stdio | `/Applications/GenOffice.app/Contents/Resources/cli/genoffice mcp` | GenOffice documents — 32 tools to read/write docx, xlsx, pptx and pdf, render pages, merge templates |

**codebase-memory-mcp** is a high-performance code intelligence MCP server. It indexes codebases into a persistent knowledge graph for fast structural queries. It is a plain npm package, so `bootstrap.sh` installs it with `mise use -g npm:codebase-memory-mcp@latest` and every harness calls it by bare name off PATH — no absolute path, no `npx -y` wrapper. Hard-coding a path (the old `~/.local/bin/...` / `/Users/...` forms) was the bug: the binary lives wherever mise's node install puts it, so a pinned path silently became a spawn failure.

**Enabled by default, opt-in per machine.** `codebase-memory-mcp` is `enabled: true` everywhere because `bootstrap.sh` guarantees the binary exists. `genoffice` is `enabled: false` (omp, OpenCode) or `lifecycle: "lazy"` (Pi) because it lives inside a macOS app bundle — flip it on after `genoffice install-cli` on a machine that actually has GenOffice. `pencil` is **not** configured anywhere: it is a macOS-only app-bundle binary (`/Applications/Pen.app/...`), so every non-macOS host paid a failed spawn per launch for a tool it could never run. Pen still gets its model list from `~/.pencil/models.json`; only its MCP server is gone.


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
| 7 | `smol` | Cheapest jobs — last entry so `designer` stays the default |

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

## GenOffice

[GenOffice](https://genoffice.ai) is a macOS desktop document suite whose
bundled CLI exposes a 32-tool MCP server (docx, xlsx, pptx, pdf). It is
registered but **disabled by default** here, because the binary lives inside a
macOS app bundle that most hosts do not have — see the MCP Servers table in the
OMP section. Install steps, the `ai-settings.json` provider recipe (including
the `provider: "custom"` trap) and the empty-model-dropdown diagnosis are in
[docs/genoffice.md](./docs/genoffice.md).

## DeepSeek Harness (dsh)

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) is
DeepSeek's open-source agent harness — "everything is a plugin", built on the
[Cordis](https://github.com/cordiverse/cordis) plugin framework. It is the
intended long-term replacement for `omp` here, so it is stowed alongside it
rather than added as an ad-hoc install.

### Config Files Managed in This Repo

Stowed (symlinked, `--no-folding`):

- `dsh/.dsh/cordis.patch.yml` → `~/.dsh/cordis.patch.yml` (home-level patch)
- `dsh/.config/systemd/user/dsh-web.service` → `~/.config/systemd/user/` (the web
  profile as a user unit, loopback `127.0.0.1:3080`)
- `dsh/.config/systemd/user/dsh-web-cookie.{service,timer}` → `~/.config/systemd/user/`
  (daily re-mint of the nginx cookie snippet; see *Web UI Access* below)
- `dsh/bin/dsh-web-cookie-refresh` → `~/bin/` (the script those units run)
- `dsh/etc/nginx/sites-available/dsh.workofekajaya.com` → `~/etc/nginx/...`
  (tracked copy; `/etc/nginx` is root-owned, so installing it is a manual `cp`)

Seeded, not stowed (copied by `dsh/install.sh --profiles`):

- `dsh/.dsh/profiles/{web,headless,tui}/{cordis.patch.yml,package.json,pnpm-workspace.yaml,compatibility.json}`
  → `~/.dsh/profiles/<name>/`

Never tracked: `.credentials.yaml`, `logs/`, `profiles/*/node_modules/`,
`profiles/*/pnpm-lock.yaml`.

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

### Profile Config Is Seeded, Never Symlinked

The profile's own `cordis.patch.yml` and manifest *are* versioned — they carry
the MCP rows (Hevy, arXiv), the auto-archive schedule and the 9router route, and
losing them means rebuilding by hand. But three constraints shape how they land:

1. **`dsh` claims a profile directory exclusively** — the launcher rejects a
   target whose directory already exists. So the seeds cannot be stowed; a
   stowed `~/.dsh/profiles/web/` would make `dsh web` fail on a fresh machine.
2. **`dsh` writes config with `writeFileAtomic`**, which writes a temp sibling
   and `rename()`s it over the target. `rename()` *replaces* a symlink instead
   of writing through it, so a stowed link is silently severed on the first
   settings save or `dsh plugin add`. This is the same reason the service env is
   copied. `dsh/.stow-local-ignore` excludes `^/\.dsh/profiles(/|$)` — note the
   leading `"/"`, because stow matches patterns against a `/`-prefixed
   package-relative path.
3. **pnpm owns `package.json` and the lockfile.** It rewrites the manifest in
   place and preserves symlinks, but `pnpm-lock.yaml` churns on every install and
   is derived, so it stays machine-local.

`dsh/install.sh` therefore seeds the repo copies into `~/.dsh/profiles/` and
never overwrites a file that already exists with different content — it reports
the drift instead, because the live copy may hold a settings change made in the
UI. `./install.sh --capture` copies live edits back into the repo, which is the
step to run after changing settings in the dashboard.

### Not Synced (machine-local state and secrets)

| Path | Why it stays local |
|------|--------------------|
| `.credentials.yaml` | **Provider API keys** |
| `logs/` | Startup diagnostics that can echo credential values |
| `profiles/*/node_modules/` | pnpm-managed dependency tree |
| `profiles/*/pnpm-lock.yaml` | Derived from the manifest; churns on every install |

The root `.gitignore` ignores everything under `dsh/.dsh/` and re-admits only
`cordis.patch.yml` at the home level and, per profile, `cordis.patch.yml`,
`package.json`, `pnpm-workspace.yaml` and `compatibility.json` — so a fold or a
stray `git add` cannot leak secrets or vendored packages.

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
executable code outside the agent sandbox. This repo's home patch mounts
exactly one — `genoffice` (`genoffice mcp`, the document engine) — as row
`mcp-genoffice`; its tools reach the model as
`mcp__genoffice__<name>`. Verify with:

```bash
dsh --profile web --dump-config | grep -A5 mcp-genoffice
dsh --profile headless "list your mcp__genoffice__ tools"
```

`dsh-mcp-client` is bundled with the pinned release, so the row needs no
`dsh plugin add`. The launcher resolves the app bundle itself and runs the
bundled CLI on the app's own Electron-as-Node runtime, so it works even under
a scrubbed `PATH`.

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

A kanban board with a dispatcher is `auto_decompose` plus a periodic
claim/assign tick across workers. dsh has no single first-party equivalent; it
splits across two pieces:

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
serves — `https://ai.workofekajaya.com/v1/messages` — so the adapter fits the
gateway without a translation layer, and the adapter's rule that "an exact final
`/v1` segment is reused" lines up with that base URL. (Claude Code does *not*
use this route — it stays on Anthropic's own API; see its section below.)

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

**The route row alone is not enough — a second row selects the model.** A patch
row registers a provider route; it does not make that route the one agents
call. The selection lives in the `agent-default-model` row, which ships
pointing at `provider: deepseek-official` / `model: deepseek-flash`. Against
9router that model id does not exist, so the turn fails with
`INVALID_REQUEST: [400]: deepseek-flash is not a valid model ID` — verified
2026-10-23. Both rows are required:

```yaml
# ...the llm-deepseek row above, plus:
- id: agent-default-model
  config:
    provider: deepseek-official   # the route name is a fixed constant
    model: coder                  # a 9router combo id
```

The provider route name `deepseek-official` is hardcoded in
`@deepseek-ai/dsh-llm-deepseek-api-key`; only the model id changes.

**The `[DONE]` sentinel is not a constraint here.** 9router's translated
`/v1/messages` streams close on `event: message_stop` without a
`data: [DONE]` sentinel, and `9router/README.md` records that as a gateway bug
worth a rebuild. It does not affect dsh on the pinned release: the
`@deepseek-ai/dsh-llm-deepseek` parser terminates on `message_stop` and throws
`STREAM_CLOSED` only when that event is missing — the string
`without [DONE]` appears nowhere in the installed dsh. Verified end to end
2026-10-23: a tool-calling turn against the gateway completes on both the
`coder` and `advisor` combos. Do not switch adapters over the sentinel.

The model ids mirror the combos already used by omp (`coder`,
`personal-chat`, `advisor`), and the adapter passes unlisted ids through
unchanged, so a catalog entry is only needed for GUI selection.


The shipped default needs no patch at all: `llm-deepseek` points at DeepSeek's
official API using `DEEPSEEK_API_KEY` (exported from `~/.zshenv.local`).

**Per-subagent model choice** is separate from provider plumbing: the delegation
tool's `modelSelectionSettings: true` lets the orchestrator pick a model per
subagent (see the swarm section).

`@deepseek-ai/dsh-llm-pi-ai` ships in `dsh-base` as row id `llm-pi-ai` and
mounts **dormant** — zero routes until a `providers` map supplies them. It is
the right adapter when several providers must be served at once, or when a
gateway speaks chat-completions only. For a single OpenAI-compatible gateway
such as 9router, `llm-deepseek` is the smaller change and needs no
`providers` map.

### Multi-Profile

dsh has native multi-profile support — the profile is a real unit, and its
*plugins* are per-profile:

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
`node_modules/`. Their **config** is versioned as a seed and copied in by
`dsh/install.sh --profiles`; their `node_modules/` and lockfiles stay
machine-local. Reproduce the plugins themselves on a new machine with
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

### Web UI Access (this host: tailnet-named, optional public literal)

This machine uses neither plugin. nginx terminates TLS for
`dsh.workofekajaya.com` and `magicdns.example.ts.net:8444`, and all proxy to
`127.0.0.1:3080`. Three listeners exist, with deliberately different auth models:

| Listener | Reached by | Auth |
|----------|-----------|------|
| `100.64.0.10:443` (tailnet) | the DNS name | none — tailnet membership is the boundary |
| `203.0.113.10:443` (public) | IP literal only | HTTP Basic (`/etc/nginx/.htpasswd-public`, credential in `~/.dsh-web-pass`, 0600) |
| `100.64.0.10:8444` (tailnet, MagicDNS name) | `https://magicdns.example.ts.net:8444` | none — tailnet bind, cookie injected |

The DNS A record for the name is `100.64.0.10`, the tailnet address. That is
deliberate: **every** client that has ever used this vhost is a tailnet device,
so the name must resolve to the tailnet listener, which has no `auth_basic`.
Pointing the name at the public address (as it was earlier on 2026-10-26) sent
all of them through the Basic prompt — the "login page" this vhost must not
have. Off-tailnet clients cannot route `100.x`, so nothing is exposed by this.

`auth_basic` stays on the public listener because nginx injects the
browser-session cookie unconditionally, so that block is the one an
off-tailnet client can touch. Do **not** try to relax it with
`satisfy any; allow 100.64.0.0/10;`. That was tried and removed: with
`AdvertiseRoutes` null and `RouteAll` false, nothing routes the public IP into
the tailnet, so a peer dialing `203.0.113.10` arrives on eth0 with its own
public source address and the allow-list never matches.

The MagicDNS listener is the short, passwordless URL (`https://magicdns.example.ts.net:8444`)
and exists because `tailscale serve` **cannot** front dsh: dsh answers `401` to
every request without its authority-bound cookie and `403` to every `/api`
request whose Host is not in `trustedHosts`, and Tailscale's proxy injects
neither (measured through it: html `401`, api `403`). It reuses the tailscale
cert in `/etc/nginx/ssl/host.ts.{crt,key}`, kept current by
`host-ts-cert-refresh.timer`. Two details are load-bearing:

- the port must be `:8444`, not `:443`: MagicDNS `:443` already selects the
  `nine-router-tailscale` vhost, and nginx matches on listen address+port first;
- the block forwards `$http_host` (port included) and dsh is started with
  `--trusted-host magicdns.example.ts.net:8444`, because the fence compares
  `new URL(Origin).host` verbatim against the request Host. `$host` strips the
  port and every `POST /api` from that origin then answers `403`.

### SSH to this host

`ssh personal@dsh-host` (or `@magicdns.example.ts.net`, or either IP) works
with **password auth against sshd on port 22**. The password is in
`~/.ssh-pass-personal` (0600, mode `personal`).

**This password is root-equivalent.** `personal` is in `sudo` *and* `docker`,
and docker-group membership alone grants root. `sshd` listens on `0.0.0.0:22`
with password auth on, the box takes ~1300 failed root logins per hour from
dozens of IPs, and there is no fail2ban. So the 24-character password is the
only barrier between the open internet and root on this host. Do not commit
that file, do not paste it into a transcript, and consider
`PermitRootLogin prohibit-password` plus restricting `:22` to `tailscale0` —
both were deliberately left alone here because they were outside the request.

Two things matter for keeping it working:

- `personal` was **locked** (`passwd -S` showed `L`) with only the box-local
  `hermes-backup` key authorized, so no remote client could authenticate.
- Tailscale SSH is **off** (`RunSSH: false`, stored in `tailscaled.state` by
  `tailscale set --ssh=false`). It is not interception-capable on this host:
  the `ts_ssh` REDIRECT chain is absent from every table while tailscaled still
  listened on a random tailnet port, so its `SSHPolicy` was never consulted and
  its expiring check-mode approvals were what kept breaking logins.

Do **not** pin `--ssh=false` in `/etc/default/tailscaled`; it is a preference,
not a `tailscaled` flag, and doing so makes the unit fail to start.

**Known follow-up:** `sum` (`100.64.0.11`) authenticated *only* via Tailscale
SSH — two sessions, zero `Accepted` lines in `journalctl -u ssh` — and has no
stored password for `personal`, so it is broken until its pubkey is appended to
`~/.ssh/authorized_keys`. It was offline (last seen 4h, ping 100% loss) and its
netmap entry carries `sshHostKeys: []`, so the key cannot be recovered from this
box; do it when it is next online. `iphone183` is unaffected — it never used
either path (zero sessions in both logs).

The vhost lives in `dsh/etc/nginx/sites-available/dsh.workofekajaya.com` as a
tracked copy — `/etc/nginx` is root-owned, so it is installed by hand, not
stowed. Re-install it after editing; a `--capture` run does not touch it.

dsh still requires its own signed browser-session cookie, which would otherwise
mean opening a fresh `?token=` URL after every restart. Two pieces remove that:

| Piece | What it does |
|-------|--------------|
| `dsh/bin/dsh-web-cookie-refresh` | Re-mints one cookie per served authority and installs each as its own snippet — `/etc/nginx/snippets/dsh-web-cookie.conf` (`dsh.workofekajaya.com`) and `dsh-web-cookie-tailnet.conf` (`magicdns.example.ts.net:8444`) — which the vhosts `include` as a `proxy_set_header Cookie`. Separate files are required: the cookie *name* hashes the authority, so one shared snippet would silently break whichever authority minted last. |
| `dsh-web-cookie.timer` | Runs the script `OnBootSec=2min` and daily, well inside the cookie's own 25-day window. |

The signing secret is durable (the `client-connection/browser-session` record in
`~/.dsh/.credentials.yaml`); only the issue/expiry window ages out, which is why
a re-mint is enough. The script needs root only to write the snippet and reload
nginx (`sudo -n` for a user run), and it reads no secret from the repo.

**Consequence to keep in mind:** on the tailnet every device still gets full
operator access with no prompt, and the public block is protected by that single
Basic credential. Rotate it with
`sudo htpasswd /etc/nginx/.htpasswd-public ekajaya`, or narrow with
`allow`/`deny` / Tailscale ACLs.

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

**Backend: 9router SystemOne, not OpenRouter and not TypeSafe.** 9router exposes
Jev 1.14 as the model alias `judge` in its `modelAliases` kv scope, backed by
`openrouter/typesafe/jev-1.14` through the `openrouter` provider. Every Jev
consumer reaches it at `POST https://ai.workofekajaya.com/v1/systemone` with
`model: judge` and `JEV_PROVIDER=compatible`, authenticated with
`NINEROUTER_API_KEY` — so there is no separate `OPENROUTER_API_KEY` or
`TYPESAFE_API_KEY` to manage, and the key never has to leave the gateway.

**Clients send `judge`, never `openrouter/typesafe/jev-1.14`.** The latter is a
9router-internal alias, resolved inside the gateway; copying it into a client
config only works if that config also points at 9router. Pointed at OpenRouter
direct it fails with `401 User not found.` — OpenRouter's reply to a key that is
revoked or belongs to no account, which is also what a config left over from the
abandoned OpenRouter-direct era produces.

OpenRouter direct was abandoned: the account's allowed-providers guardrail
permits only `typesafe`, so every other OpenRouter model 404s. Routing through
9router sidesteps that. It was briefly wired in as the **smart-router
`routerModel`** for every combo, then removed: `buildChoiceCriteria()` maps each
member to a bare `null`, so the judge ranks on vendor names with no price or
latency input, its confidence sits at 0.07–0.58 (p50 ≈ 0.13) against a 0.8
default, and a below-threshold answer writes no sticky entry — so it cost a
~500 ms round trip per turn to reproduce an order that member sequencing already
encodes. `judge` remains an alias and an MCP tool; it is not in the request path.

**Jev is a decisions model — it cannot write prose.** On `/v1/chat/completions`
it returns `typesafe/jev-1.14 is a decisions model and cannot be used with the
chat/completions endpoint`. It answers typed questions (`noul | choice | score |
box`) on `/v1/systemone` only. So it can never be a combo member or a fusion
`judgeModel`, and it no longer serves as a `routerModel` either — its place is
the MCP/decision tools.

### What Is Synced vs Machine-Local

| Part | Location | Synced? |
|------|----------|---------|
| MCP server entry (`jev-mcp`) | `opencode/.config/opencode/opencode.json`, `claude/.claude/skills/jev-router/.claude-plugin/plugin.json` | ✅ stowed |
| Everything else — CLI, plugins, node_modules | `~/.omp/plugins`, `~/.local/bin/jev`, `~/.pi/agent/npm` | ❌ machine-local |

`jev-mcp` is deliberately **not** in `omp/.omp/agent/mcp.json`: omp carries its
own Jev integration instead, and a second MCP entry would duplicate the same
decision endpoint.

`bootstrap.sh` runs **`jev/install.sh`** (idempotent, `--check` for a dry run)
to reproduce the machine-local half on a new device.

### Components

| Component | Harnesses | Notes |
|-----------|-----------|-------|
| `omp-jev` | omp | Jev routing; config at `~/.config/omp-jev/config.json` (pointed at 9router SystemOne, model `judge`). |
| `omp-jev-compaction` | omp | Jev-scored context reduction. Built from source into `~/.omp/plugins-local/`, linked with `omp plugin install <path>`. |
| `pi-warden` | pi only | Guardrails. `typesafeBackend` in `~/.pi/agent/pi-warden/config.json` is a backend **endpoint object** — `host: https://ai.workofekajaya.com`, `path: /v1/systemone`, `keyEnv: NINEROUTER_API_KEY`, `defaultModel: judge` — not the name `openrouter`, which would send judgments to `openrouter.ai` direct. **Not installed for omp**: omp is kept plugin-free so its only skills are the binary's own, and warden would re-add plugin skill registrations plus per-turn guard calls. |

### Pen Cannot Run jev-mcp

Pen launches with `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, so it cannot resolve
`npx` (the same reason `spawn npm ENOENT` appears in `~/Library/Logs/Pen/main.log`).
Jev MCP is registered in **opencode and Claude Code (via the jev-router
plugin) only** — not omp, which no longer routes through Jev at all. Pen
gets Jev only if a compiled binary ships.

### Consent and Defaults

- `pi-warden`: judgments are **off** until `/warden enable` (its disclosure
  names the configured backend's host, i.e. `ai.workofekajaya.com`, not
  `openrouter.ai`). Offline guards work without any key.
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

**Claude Code stays on Anthropic's own API.** It is the one harness here that
does *not* ride 9router: no `ANTHROPIC_BASE_URL`, no `apiKeyHelper`, no model
aliases. Auth comes from `~/.claude/.credentials.json` (the normal `claude`
login), and the model is whatever the user last picked in `/model`.

This was tried the other way and reverted — pointing `ANTHROPIC_BASE_URL` at
`https://ai.workofekajaya.com` with `coder`/`advisor`/`smol` as the Sonnet/Opus/
Haiku aliases worked, but it silently replaced the user's own Claude
subscription with gateway spend and dropped the `unrecognized_model` notice
that `CLAUDE_CODE_MAX_CONTEXT_TOKENS` used to hide. Keep 9router out of this
file unless the user asks for it explicitly.

`settings.json` therefore carries only non-model keys: `statusLine`,
`enabledPlugins`, `extraKnownMarketplaces`, `skipDangerousModePermissionPrompt`,
and `$schema`. `claude/install.sh` **deletes** the retired model keys rather
than unioning them in, so a stale `env`/`apiKeyHelper` cannot survive a
template that no longer defines it (see the `RETIRED_ENV` list in that script).

The `jev-router` plugin below still reaches 9router — it is a routing hook, not
the model path.

### jev-router (Jev subagent routing)

`claude/.claude/skills/jev-router/` is a Claude Code plugin (auto-loads from the
skills dir as `jev-router@skills-dir`). It carries:

- a `PreToolUse` hook on `Task|Agent` that asks TypeSafe Jev — through 9router
  SystemOne (`POST /v1/systemone`, model `judge`) — which
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
cd ~/dotfiles && stow --no-folding pi
```

`--no-folding` is required, not cosmetic: `~/.pi/agent` also holds `auth.json`,
`sessions/`, `npm/` and `pi-warden/`, so a plain `stow pi` on a host without an
existing `~/.pi/agent` folds the directory into one symlink and Pi writes that
state into this repo. `pi` is in `STOW_NO_FOLDING`.

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

[rest.nvim](https://github.com/rest-nvim/rest.nvim) runs `.http` requests from
inside Neovim: `<leader>rr` on a request, `<leader>rl` for the last one. The
config lives in `nvim/.config/nvim/`; the full syntax guide, command table and
env-file workflow are in [docs/rest-nvim.md](./docs/rest-nvim.md).

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
