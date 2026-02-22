# dotfiles

Personal configuration for Neovim, tmux, and OpenCode.

## Repository Layout

- `nvim/nvim/` -> `~/.config/nvim`
- `tmux/.tmux.conf` -> `~/.tmux.conf`
- `opencode/opencode.json` -> `~/.config/opencode/opencode.json`
- `opencode/oh-my-opencode.json` -> `~/.config/opencode/oh-my-opencode.json`

## Dependencies

### Required

- `git`, `neovim`, `tmux`
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

### Optional by environment

- Linux clipboard helpers: `xclip` (X11) and/or `wl-clipboard` (Wayland)
- Android/iOS simulator tools if you use `telescope-simulators.nvim`

## Install Dependencies

### macOS (Homebrew)

```bash
xcode-select --install
brew tap oven-sh/bun
brew install git neovim tmux node yarn bun jq tidy-html5 ripgrep fd fzf tree-sitter lua-language-server stylua shellcheck shfmt graphviz chafa
```

### Arch Linux (pacman)

```bash
sudo pacman -S --needed git neovim tmux nodejs npm yarn bun base-devel jq tidy ripgrep fd fzf tree-sitter lua-language-server stylua shellcheck shfmt graphviz chafa xclip wl-clipboard
```

### Arch Linux (yay)

Use this if you prefer a single command through AUR helper flow, or if a package is temporarily missing in official repos.

```bash
yay -S --needed git neovim tmux nodejs npm yarn bun base-devel jq tidy ripgrep fd fzf tree-sitter lua-language-server stylua shellcheck shfmt graphviz chafa xclip wl-clipboard
# fallback if bun is unavailable from current repos:
# yay -S --needed bun-bin
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
[ -e ~/.config/opencode/opencode.json ] && mv ~/.config/opencode/opencode.json ~/.config/opencode/opencode.json.bak.$(date +%Y%m%d-%H%M%S)
[ -e ~/.config/opencode/oh-my-opencode.json ] && mv ~/.config/opencode/oh-my-opencode.json ~/.config/opencode/oh-my-opencode.json.bak.$(date +%Y%m%d-%H%M%S)
```

### 3) Symlink this repo into home config paths

```bash
ln -sfn ~/dotfiles/nvim/nvim ~/.config/nvim
ln -sfn ~/dotfiles/tmux/.tmux.conf ~/.tmux.conf
ln -sfn ~/dotfiles/opencode/opencode.json ~/.config/opencode/opencode.json
ln -sfn ~/dotfiles/opencode/oh-my-opencode.json ~/.config/opencode/oh-my-opencode.json
```

### 4) First run

- Open `nvim` and let plugins install (`packer.nvim` bootstrap is in config).
- Install TPM if needed: `git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm`, then press `prefix + I` in tmux.
- Restart OpenCode so provider/agent config reloads.

## For Agents

Use this section for automation and CI-style setup.

### Contract

- Edit tracked files in this repo only, not resolved paths under `$HOME`.
- Keep symlink mapping stable:
  - `~/dotfiles/nvim/nvim` <-> `~/.config/nvim`
  - `~/dotfiles/tmux/.tmux.conf` <-> `~/.tmux.conf`
  - `~/dotfiles/opencode/opencode.json` <-> `~/.config/opencode/opencode.json`
  - `~/dotfiles/opencode/oh-my-opencode.json` <-> `~/.config/opencode/oh-my-opencode.json`

### Idempotent checks

```bash
command -v git nvim tmux node npm bun jq >/dev/null
jq empty opencode/opencode.json opencode/oh-my-opencode.json
ls -l ~/.config/nvim ~/.tmux.conf ~/.config/opencode/opencode.json ~/.config/opencode/oh-my-opencode.json
```

### Safety

- Do not commit secrets or tokens.
- Preserve user model/provider choices unless explicitly requested.
- Keep changes minimal and style-consistent.
