# Agent Instructions

This document provides guidelines for AI agents and automation tools working with this dotfiles repository.

## Quick Reference

- **Source of truth**: Edit files in this repo only, never resolved paths under `$HOME`
- **Symlink management**: Use `stow` for creating/managing symlinks
- **Validation**: Always run checks before and after changes
 **Keybindings**: See [KEYBINDINGS.md](./KEYBINDINGS.md) for custom shortcuts

## Repository Structure

```
~/dotfiles/
├── nvim/.config/nvim/          → ~/.config/nvim
├── tmux/.tmux.conf             → ~/.tmux.conf
└── opencode/.config/opencode/  → ~/.config/opencode/
```

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
ls -l ~/.config/nvim ~/.tmux.conf ~/.config/opencode/

# Test configs
nvim --headless -c 'quit' 2>/dev/null && echo "nvim OK"
tmux -f ~/.tmux.conf list-keys 2>/dev/null | head -1
```

### Restowing

If symlinks break or need refresh:

```bash
cd ~/dotfiles
stow -D nvim tmux opencode  # Unstow
stow nvim tmux opencode      # Restow
```

## Safety Rules

- **Never** commit secrets, tokens, or credentials
- **Never** modify files directly in `~/.config/` or `~`
- Preserve existing user model/provider configurations unless explicitly asked
- Keep changes minimal and consistent with existing style
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
