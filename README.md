# dotfiles

Personal configuration for Neovim (LazyVim + coc.nvim), Vim, tmux, zsh,
OpenCode, [oh-my-pi](https://github.com/can1357/oh-my-pi), [Hermes](https://github.com/earendil-works/hermes),
[Pen](https://pen.dev), [Pi](https://github.com/earendil-works/pi), and Claude Code.
Everything is stowed into `$HOME` with GNU Stow, except the pieces noted below.

**Neovim includes:**
- [rest.nvim](https://github.com/rest-nvim/rest.nvim) - HTTP client for testing APIs directly from `.http` files (see [AGENTS.md](./AGENTS.md) for usage)

**AI harnesses** all ride the same **9router** gateway, so they share model
combos and fallback chains:

- **oh-my-pi (OMP)** - AI coding agent for the terminal (`omp` CLI), with 9router model roles (see [AGENTS.md](./AGENTS.md) for details)
- **Hermes** - gateway-capable agent with Discord/Telegram/Slack front ends, a dashboard, memory, and TTS/STT
- **Pen (pen.dev)** - design tool whose bundled agent uses the 9router provider stowed from this repo
- **OpenCode** - terminal coding agent
- **Claude Code** - 9router Anthropic gateway (`ANTHROPIC_BASE_URL`) with the combo models as Claude model aliases, plus a `jev-router` plugin whose `PreToolUse` hook asks TypeSafe Jev (via 9router SystemOne) which agent and model a subagent call needs — read-only lookups are routed to the Explore agent on Haiku (see [AGENTS.md](./AGENTS.md))

**Pi agent extensions:**
- [pi-notify-pp](https://github.com/kim0/pi-notify-pp) - Native terminal notifications for Pi agent turns (OSC 777, works with Ghostty/iTerm2)

## Repository Layout

### Stowed packages

Deployed by `stow <package>` (see `bootstrap.sh`); the package name is the
top-level directory.

- `nvim/.config/nvim/` -> `~/.config/nvim`
- `vim/.vimrc`, `vim/.vim/` -> `~/.vimrc`, `~/.vim`
- `tmux/.tmux.conf` -> `~/.tmux.conf`
- `zsh/.zshenv` -> `~/.zshenv`
- `zsh/.zprofile` -> `~/.zprofile`
- `zsh/.zshrc` -> `~/.zshrc`
- `zsh/.p10k.zsh` -> `~/.p10k.zsh` (placeholder, run `p10k configure` to generate)
- `opencode/.config/opencode/opencode.json` -> `~/.config/opencode/opencode.json`
- `opencode/.config/opencode/oh-my-openagent.json` -> `~/.config/opencode/oh-my-openagent.json`
- `omp/.omp/agent/config.yml` -> `~/.omp/agent/config.yml` (settings, model roles)
- `omp/.omp/agent/models.yml` -> `~/.omp/agent/models.yml` (custom providers & models)
- `omp/.omp/agent/mcp.json` -> `~/.omp/agent/mcp.json` (MCP servers)
- `hermes/.hermes/config.yaml` -> `~/.hermes/config.yaml` (v49 schema: models, toolsets, MCP servers, platforms)
- `hermes/.hermes/AGENTS.md`, `SOUL.md`, `CLAUDE.md` -> `~/.hermes/` (instructions, persona, Claude interop)
- `hermes/.hermes/memories/` -> `~/.hermes/memories/` (curated memory)
- `pi/.pi/agent/extensions/pi-notify-pp/` -> `~/.pi/agent/extensions/pi-notify-pp/` (Pi Notify++ extension)
- `pen/.pencil/models.json` -> `~/.pencil/models.json` (9router provider for Pen; stow with `--no-folding`)
- `dsh/.dsh/cordis.patch.yml` -> `~/.dsh/cordis.patch.yml` (DeepSeek Harness home-level patch; stow with `--no-folding`)
- `omarchy/.config/hypr/` -> `~/.config/hypr` (Hyprland/Omarchy; **Arch-only, stow by hand** — not in `STOW_PACKAGES`)

`omp`, `pen` and `dsh` share their target directory with app-managed state
(databases, sessions, credentials), so they must be stowed with `--no-folding`
(handled by `bootstrap.sh` and `sync-dotfiles.sh` via `STOW_NO_FOLDING`).

**DeepSeek Harness (`dsh`)** is pinned by `bootstrap.sh` and set up as the
long-term replacement for `hermes` and `omp`. Only the home-level patch is
synced; the swarm and kanban are first-party/native and the rest is per-profile:

- **In-process multi-agent swarm** — `subagent` / `subagent-spawn-in-process` /
  `subagent-fork-in-process` ship in `dsh-base`, with `tool-subagent` and
  `tool-subagent-control` as the model-facing delegation tools. Per-subagent
  model selection is first-party (`modelSelectionSettings`), so mirroring omp's
  `modelRoles` needs no plugin. Nothing shells out to Codex or Claude Code —
  those backends are absent from the pinned release.
- **Kanban** — `@dsh-suite/plugin-team-board` gives a shared board
  (`ctx.teamBoard`) with `task_create` / `task_claim` / `task_update` visible
  across agents and subagents, persisted at `$DSH_HOME/team-board/board.json`.
  Verify its tools reach a web session first: in `web` the model-facing tools
  are owned by the agent preset, so a profile plugin that registers on the host
  plane may not be visible to the agent.
- **Profiles** — `web` (browser UI) and `headless` (one-shot CLI). Native
  multi-profile, stronger than hermes': plugins are per-profile. Profile trees
  are machine-local and never synced.
- **Telemetry** — three egresses. `session-log-deepseek` (message text) and
  `plugin-package-inventory-deepseek` are switched off with `enabled: false` in
  the home patch; `session-telemetry-otel` **cannot** be disabled from config and
  uses `DSH_TELEMETRY_DISABLED=1` in `zsh/.zshenv`.
- **Remote access** is Tailscale-only (`dsh-tailscale-gateway`), never a public
  `0.0.0.0` bind, because the agent has a shell.

See the *DeepSeek Harness (dsh)* section in [AGENTS.md](./AGENTS.md) for the row
map, layer order, and plugin commands.

### Stowing a subset

`bootstrap.sh` and `sync-dotfiles.sh` accept the same selection flags, so a
fresh machine can take just the harness configs:

```bash
./bootstrap.sh --harness --skip-deps --sync-only   # harness configs only
./bootstrap.sh --only omp,hermes                   # arbitrary subset
./sync-dotfiles.sh --sync-only --harness           # daily sync, harness only
```

Groups (`harness`, `editor`, `shell`) and the package list live in
`scripts/packages.sh`, shared by both scripts and the CI validator. Selecting a
subset never unlinks the packages you left out.

### Not stowed (installer scripts and tooling)

- `claude/.claude/settings.json` -> merged into `~/.claude/settings.json` by `claude/install.sh` (9router gateway, model aliases, status line)
- `claude/.claude/mcp.json.template` -> merged into `~/.claude.json` by `claude/install.sh` (user-scope MCP servers)
- `claude/.claude/skills/jev-router/` -> `~/.claude/skills/jev-router` (Jev subagent-routing plugin; symlinked by `claude/install.sh`)
- `jev/install.sh` -> installs the Jev toolchain into machine-local dirs (no config of its own)
- `9router/export.sh` -> refreshes `9router/config-export.json`, an auto-exported snapshot of the 9Router gateway
- `hypr-lua/omarchy4/` -> Omarchy 4 Lua port (not yet stowed)
- `.agents/skills/` -> **not tracked** (third-party agent skills; managed in the separate `ekajaya740/skills` collection repo — see *Agent Skills* below)

### Repo tooling and CI

- `scripts/packages.sh` -> the single source of truth for package lists, groups, and the `--no-folding` rule; sourced by both installers and the validator
- `scripts/validate.sh` -> the check suite (ShellCheck, JSON, YAML, `stow --simulate`, changelog); run it locally with `make validate`
- `scripts/release_dotfiles.py` -> tags the version at the top of `CHANGELOG.md`
- `CHANGELOG.md` -> drives releases; the newest `## [x.y.z]` section is what ships
- `.github/workflows/validate.yml` -> runs `scripts/validate.sh` on every push and PR
- `.github/workflows/release.yml` -> on a `CHANGELOG.md` bump to `main`, tags `dotfiles-vX.Y.Z` and publishes the release

## Dependencies

### Required

- `git`, `stow`, `tmux`, `zsh`
- `mise` (runtime version manager — installs `node`, `yarn`, `make`, `neovim`, `vim`, `opencode`, `pi` automatically via `bootstrap.sh`)
- `bun` (OpenCode MCP commands use `bunx`; ≥ 1.3.7 required by oh-my-pi)
- `jq` and `tidy` (`rest.nvim` formatters)

### Managed by mise (installed by `bootstrap.sh`)

These are installed automatically via `mise use -g`:

- `node` (LTS) — includes `npm`
- `yarn` — used by some Neovim plugin installers
- `make` — required by `telescope-fzf-native`
- `neovim` (stable) — editor
- `vim` (latest) — editor
- `opencode` (latest) — terminal coding agent
- `pi` (latest) — Pi coding agent

### Installed separately (not in mise registry)

- **oh-my-pi (omp)** — installed via `bun install -g @oh-my-pi/pi-coding-agent` or the install script; not available in mise

### Recommended

- `ripgrep`, `fd`, `fzf`, `tree-sitter`
- `lua-language-server`, `stylua`, `shellcheck`, `shfmt`
- `graphviz` (for `graphviz.vim`)
- `chafa` (media preview tooling)

### Zsh

- **Oh My Zsh** - Framework for managing zsh configuration
- **Powerlevel10k** - Prompt theme
- **Plugins** (custom, must install separately):
  - `zsh-autosuggestions` - Fish-like autosuggestions
  - `zsh-syntax-highlighting` - Real-time syntax highlighting

### Optional by environment

### Platform Detection

The zsh configuration automatically detects your platform:

 **Omarchy** - Detected via `/etc/os-release` ID, `~/.local/share/omarchy`, `~/.config/omarchy`, or `Hyprland` desktop
 **Arch Linux** - Detected via `/etc/os-release` ID matching `arch`, `archlinux`, or `omarchy`
 **macOS** - Detected via `uname`

Omarchy-specific behavior:
 Uses bundled powerlevel10k from `$DOTFILES_OMARCHY_HOME/zsh/plugins/powerlevel10k` if available
 Skips `startx` in `.zprofile` (Omarchy uses Wayland/Hyprland)
 Sets `DOTFILES_IS_OMARCHY=1` and `DOTFILES_OMARCHY_HOME` environment variables

- Linux clipboard helpers: `xclip` (X11) and/or `wl-clipboard` (Wayland)
- Android/iOS simulator tools if you use `telescope-simulators.nvim`
- JDK 17+ if you use Java via `coc-java`

## Install Dependencies

### Quick install (recommended)

The `bootstrap.sh` script handles everything including mise, node, yarn, make, neovim, vim, opencode, pi, and omp:

```bash
bash bootstrap.sh
```

### Manual install

#### mise (runtime version manager)

```bash
curl https://mise.run | sh
mise use -g node@lts yarn@latest make@latest neovim@stable vim@latest opencode@latest pi@latest
```

#### macOS (Homebrew)

```bash
xcode-select --install
brew tap oven-sh/bun
brew install git stow tmux zsh bun jq tidy-html5 ripgrep fd fzf tree-sitter lua-language-server stylua shellcheck shfmt graphviz chafa
brew install powerlevel10k
# If not using mise for neovim/vim/node/yarn/make/opencode:
# brew install neovim vim node yarn make
```

#### Arch Linux (pacman)

```bash
sudo pacman -S --needed git stow tmux zsh bun base-devel jq tidy ripgrep fd fzf tree-sitter lua-language-server stylua shellcheck shfmt graphviz chafa xclip wl-clipboard
# If not using mise for neovim/vim/node/yarn/make/opencode:
# sudo pacman -S --needed neovim vim nodejs npm yarn make
```

### Arch Linux (yay)

Use this if you prefer a single command through AUR helper flow, or if a package is temporarily missing in official repos.

```bash
yay -S --needed git stow tmux zsh bun base-devel jq tidy ripgrep fd fzf tree-sitter lua-language-server stylua shellcheck shfmt graphviz chafa xclip wl-clipboard
# fallback if bun is unavailable from current repos:
# yay -S --needed bun-bin
# If not using mise for neovim/vim/node/yarn/make/opencode:
# yay -S --needed neovim vim nodejs npm yarn make
# Powerlevel10k (AUR)
yay -S --needed zsh-theme-powerlevel10k-git
```

### Install Oh My Zsh

```bash
sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
```

### Install Custom Zsh Plugins

```bash
# zsh-autosuggestions
git clone https://github.com/zsh-users/zsh-autosuggestions ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions

# zsh-syntax-highlighting
git clone https://github.com/zsh-users/zsh-syntax-highlighting.git ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting
```

## For Humans

### 1) Clone

```bash
git clone <your-repo-url> ~/dotfiles
```

### 2) Back up existing config

```bash
mkdir -p ~/.config/opencode
[ -e ~/.config/nvim ] && mv ~/.config/nvim ~/.config/nvim.bak.$(date +%Y%m%d-%H%M%S)
[ -e ~/.tmux.conf ] && mv ~/.tmux.conf ~/.tmux.conf.bak.$(date +%Y%m%d-%H%M%S)
[ -e ~/.zshenv ] && mv ~/.zshenv ~/.zshenv.bak.$(date +%Y%m%d-%H%M%S)
[ -e ~/.zprofile ] && mv ~/.zprofile ~/.zprofile.bak.$(date +%Y%m%d-%H%M%S)
[ -e ~/.zshrc ] && mv ~/.zshrc ~/.zshrc.bak.$(date +%Y%m%d-%H%M%S)
[ -e ~/.p10k.zsh ] && mv ~/.p10k.zsh ~/.p10k.zsh.bak.$(date +%Y%m%d-%H%M%S)
[ -e ~/.config/opencode/opencode.json ] && mv ~/.config/opencode/opencode.json ~/.config/opencode/opencode.json.bak.$(date +%Y%m%d-%H%M%S)
[ -e ~/.config/opencode/oh-my-openagent.json ] && mv ~/.config/opencode/oh-my-openagent.json ~/.config/opencode/oh-my-openagent.json.bak.$(date +%Y%m%d-%H%M%S)
[ -e ~/.omp/agent/config.yml ] && mv ~/.omp/agent/config.yml ~/.omp/agent/config.yml.bak.$(date +%Y%m%d-%H%M%S)
[ -e ~/.omp/agent/models.yml ] && mv ~/.omp/agent/models.yml ~/.omp/agent/models.yml.bak.$(date +%Y%m%d-%H%M%S)
```

### 3) Symlink this repo into home config paths

```bash
cd ~/dotfiles
stow nvim tmux zsh vim opencode omp pi hermes

# pen shares ~/.pencil with app state, so it must not be folded.
stow --no-folding pen
```

### 4) Install mise and dev tools

```bash
curl https://mise.run | sh
mise use -g node@lts yarn@latest make@latest neovim@stable vim@latest opencode@latest pi@latest
```

### 5) Install oh-my-pi (omp)

```bash
bun install -g @oh-my-pi/pi-coding-agent
# or: curl -fsSL https://raw.githubusercontent.com/can1357/oh-my-pi/main/scripts/install.sh | sh
```

### 6) First run

- Open `nvim` and let `lazy.nvim` install plugins.
- Coc will auto-install configured extensions on first startup (Java support comes from `coc-java`).
- Install TPM if needed: `git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm`, then press `prefix + I` in tmux.
- Run `p10k configure` to set up your powerlevel10k prompt (installs Meslo Nerd Font for icons).
- Restart your shell or run `exec zsh` to activate mise and all tools.
- Restart OpenCode so provider/agent config reloads.
- Run `omp` once before stowing to create `~/.omp/agent/` with local state, then `stow omp` to symlink config files.
- Run `claude` once so `~/.claude/` exists, then deploy its config: `bash claude/install.sh` (merges `settings.json` and the Jev MCP servers, and symlinks the `jev-router` plugin). The plugin loads on the next session (`/reload-plugins` to load it now). Jev routing needs `NINEROUTER_API_KEY` in `~/.zshenv.local`.

## Validation and Releases

One script holds every check, and CI runs that same script, so a green local run
means a green pipeline:

```bash
make validate          # or: ./scripts/validate.sh
```

It runs ShellCheck over the shell scripts, parses every JSON and YAML config,
dry-runs `stow` for all nine packages, and validates `CHANGELOG.md`. Every check
is fail-closed — a missing tool or a broken file exits non-zero.

### Cutting a release

Releases come from `CHANGELOG.md`: add a `## [x.y.z] - YYYY-MM-DD` section at the
top with the release notes and merge to `main`. CI then tags `dotfiles-vX.Y.Z`
and publishes a GitHub release from those notes. To see what is pending, or to
tag locally:

```bash
make release-check                              # what would be released?
python3 scripts/release_dotfiles.py --tag       # create the tag locally
```

`make lint-shell` still runs ShellCheck over just the zsh configs; it is
informational, because ShellCheck does not understand zsh syntax.

## Keybindings

See [KEYBINDINGS.md](./KEYBINDINGS.md) for a complete reference of custom keybindings for tmux, Neovim, and zsh.

## For Agents

See [AGENTS.md](./AGENTS.md) for automation and CI-style setup guidelines.
