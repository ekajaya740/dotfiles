# Keybindings Reference

This document lists all custom keybindings configured in this dotfiles repository.

## Leader Keys

| Application | Leader Key |
|-------------|------------|
| Neovim | `Space` |
| Tmux | `Ctrl-a` |

---

## Tmux

Prefix: `Ctrl-a`

### Pane Management

| Key | Action |
|-----|--------|
| `|` | Split pane horizontally (side by side) |
| `-` | Split pane vertically (top/bottom) |
| `h` | Resize pane left |
| `j` | Resize pane down |
| `k` | Resize pane up |
| `l` | Resize pane right |
| `m` | Toggle pane zoom (maximize/restore) |

### Window Management

| Key | Action |
|-----|--------|
| `,` | Rename current window |
| `r` | Reload tmux configuration |

### Copy Mode

| Key | Action |
|-----|--------|
| `v` (in copy mode) | Begin selection |
| `y` (in copy mode) | Copy selection |

### Navigation

| Key | Action |
|-----|--------|
| `Ctrl-h` | Navigate to left pane (vim-tmux-navigator) |
| `Ctrl-j` | Navigate to lower pane (vim-tmux-navigator) |
| `Ctrl-k` | Navigate to upper pane (vim-tmux-navigator) |
| `Ctrl-l` | Navigate to right pane (vim-tmux-navigator) |

### Mouse Support

Mouse mode is enabled (`set -g mouse on`):
- Click to select panes
- Drag pane borders to resize
- Scroll to enter copy mode

---

## Neovim

Leader: `Space`

### General

| Key | Mode | Action |
|-----|------|--------|
| `Space n h` | Normal | Clear search highlights |
| `Space +` | Normal | Increment number under cursor |
| `Space -` | Normal | Decrement number under cursor |
| `x` | Normal | Delete character without yanking |

### Window Management

| Key | Mode | Action |
|-----|------|--------|
| `Space s v` | Normal | Split window vertically |
| `Space s h` | Normal | Split window horizontally |
| `Space s e` | Normal | Make split windows equal size |
| `Space s x` | Normal | Close current split window |
| `Space s m` | Normal | Toggle window maximization |

### Tab Management

| Key | Mode | Action |
|-----|------|--------|
| `Space t o` | Normal | Open new tab |
| `Space t x` | Normal | Close current tab |
| `Space t n` | Normal | Go to next tab |
| `Space t p` | Normal | Go to previous tab |

### File Explorer (nvim-tree)

| Key | Mode | Action |
|-----|------|--------|
| `Space e` | Normal | Toggle file explorer |

### Telescope

| Key | Mode | Action |
|-----|------|--------|
| `Space f f` | Normal | Find files |
| `Space f s` | Normal | Live grep (search string) |
| `Space f c` | Normal | Find string under cursor |
| `Space f b` | Normal | List open buffers |
| `Space f h` | Normal | List help tags |
| `Space f m` | Normal | List media files |

### Git (Telescope)

| Key | Mode | Action |
|-----|------|--------|
| `Space g c` | Normal | List git commits |
| `Space g f c` | Normal | List commits for current file |
| `Space g b` | Normal | List git branches |
| `Space g s` | Normal | Git status with diff preview |

### LSP (coc.nvim)

| Key | Mode | Action |
|-----|------|--------|
| `g d` | Normal | Go to definition |
| `g y` | Normal | Go to type definition |
| `g i` | Normal | Go to implementation |
| `g r` | Normal | Go to references |
| `K` | Normal | Show hover documentation |
| `Space r n` | Normal | Rename symbol |
| `Space c a` | Normal | Show code actions |
| `[ g` | Normal | Go to previous diagnostic |
| `] g` | Normal | Go to next diagnostic |

### Completion (coc.nvim)

| Key | Mode | Action |
|-----|------|--------|
| `Tab` | Insert | Next completion item |
| `Shift-Tab` | Insert | Previous completion item |
| `Ctrl-Space` | Insert | Trigger completion |

---

## Zsh

Configured via Oh My Zsh with the following plugins:
- `git` - Git aliases and functions
- `zsh-autosuggestions` - Fish-like autosuggestions
- `zsh-syntax-highlighting` - Real-time syntax highlighting

### Common Oh My Zsh Aliases

| Alias | Command |
|-------|---------|
| `..` | `cd ..` |
| `...` | `cd ../..` |
| `gst` | `git status` |
| `gco` | `git checkout` |
| `gcm` | `git checkout main` |
| `gcmsg` | `git commit -m` |
| `gaa` | `git add --all` |
| `gp` | `git push` |
| `gl` | `git pull` |

---

## Notes

- All tmux keybindings require the prefix key (`Ctrl-a`) first, except for navigation keys (Ctrl-h/j/k/l) which work directly.
- Neovim keybindings use `<leader>` notation which maps to `Space`.
- For more Oh My Zsh aliases, see the [Oh My Zsh Cheatsheet](https://github.com/ohmyzsh/ohmyzsh/wiki/Cheatsheet).