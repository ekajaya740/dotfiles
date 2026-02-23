# dotfiles

Personal configuration for Neovim (LazyVim + coc.nvim), tmux, zsh, and OpenCode.

## Repository Layout

- `nvim/.config/nvim/` -> `~/.config/nvim`
- `tmux/.tmux.conf` -> `~/.tmux.conf`
- `zsh/.zshenv` -> `~/.zshenv`
- `zsh/.zprofile` -> `~/.zprofile`
- `zsh/.zshrc` -> `~/.zshrc`
- `zsh/.p10k.zsh` -> `~/.p10k.zsh` (placeholder, run `p10k configure` to generate)
- `opencode/.config/opencode/opencode.json` -> `~/.config/opencode/opencode.json`
- `opencode/.config/opencode/oh-my-opencode.json` -> `~/.config/opencode/oh-my-opencode.json`

## Dependencies

### Required

- `git`, `stow`, `neovim`, `tmux`, `zsh`
- `node` (`npm` is included with Node on both macOS and Arch)
- `bun` (OpenCode MCP commands use `bunx`)
- `make` and a C/C++ toolchain (`telescope-fzf-native` uses `run = "make"`)
- `jq` and `tidy` (`rest.nvim` formatters)
- `yarn` (used by some Node-based Neovim plugin installers)

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
 **Manjaro** - Detected via `/etc/os-release` ID matching `manjaro`
 **macOS** - Detected via `uname`

Omarchy-specific behavior:
 Uses bundled powerlevel10k from `$DOTFILES_OMARCHY_HOME/zsh/plugins/powerlevel10k` if available
 Skips `startx` in `.zprofile` (Omarchy uses Wayland/Hyprland)
 Sets `DOTFILES_IS_OMARCHY=1` and `DOTFILES_OMARCHY_HOME` environment variables

- Linux clipboard helpers: `xclip` (X11) and/or `wl-clipboard` (Wayland)
- Android/iOS simulator tools if you use `telescope-simulators.nvim`
- JDK 17+ if you use Java via `coc-java`

## Install Dependencies

### macOS (Homebrew)

```bash
xcode-select --install
brew tap oven-sh/bun
brew install git stow neovim tmux zsh node yarn bun jq tidy-html5 ripgrep fd fzf tree-sitter lua-language-server stylua shellcheck shfmt graphviz chafa
brew install powerlevel10k
```

### Arch Linux (pacman)

```bash
sudo pacman -S --needed git stow neovim tmux zsh nodejs npm yarn bun base-devel jq tidy ripgrep fd fzf tree-sitter lua-language-server stylua shellcheck shfmt graphviz chafa xclip wl-clipboard
```

### Arch Linux (yay)

Use this if you prefer a single command through AUR helper flow, or if a package is temporarily missing in official repos.

```bash
yay -S --needed git neovim tmux zsh nodejs npm yarn bun base-devel jq tidy ripgrep fd fzf tree-sitter lua-language-server stylua shellcheck shfmt graphviz chafa xclip wl-clipboard
# fallback if bun is unavailable from current repos:
# yay -S --needed bun-bin
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
[ -e ~/.config/opencode/oh-my-opencode.json ] && mv ~/.config/opencode/oh-my-opencode.json ~/.config/opencode/oh-my-opencode.json.bak.$(date +%Y%m%d-%H%M%S)
```

### 3) Symlink this repo into home config paths

```bash
cd ~/dotfiles
stow nvim tmux zsh opencode
```

### 4) First run

- Open `nvim` and let `lazy.nvim` install plugins.
- Coc will auto-install configured extensions on first startup (Java support comes from `coc-java`).
- Install TPM if needed: `git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm`, then press `prefix + I` in tmux.
- Run `p10k configure` to set up your powerlevel10k prompt (installs Meslo Nerd Font for icons).
- Restart OpenCode so provider/agent config reloads.

## Linting

Run shell linting with shellcheck:

```bash
make lint-shell
```

## For Agents

See [AGENTS.md](./AGENTS.md) for automation and CI-style setup guidelines.
