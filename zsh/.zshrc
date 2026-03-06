# Enable Powerlevel10k instant prompt. Should stay close to the top of ~/.zshrc.
# Initialization code that may require console input (password prompts, [y/n]
# confirmations, etc.) must go above this block; everything else may go below.
if [[ -r "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh" ]]; then
  source "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh"
fi

# ~/.zshrc - Interactive shell configuration
# Main zsh config with Oh My Zsh, plugins, and powerlevel10k

# -----------------------------------------------------------------------------
# Oh My Zsh Configuration
# -----------------------------------------------------------------------------

# Path to Oh My Zsh installation
export ZSH="$HOME/.oh-my-zsh"

# Theme will be set after sourcing Oh My Zsh (powerlevel10k loaded separately)
ZSH_THEME="robbyrussell"  # Default theme, overridden by powerlevel10k

# Plugins (must be before sourcing Oh My Zsh)
# Built-in: git, z, sudo, extract, colored-man-pages, docker, npm, history-substring-search
# Custom: zsh-autosuggestions, zsh-syntax-highlighting (must be installed separately)
plugins=(
    git
    z
    sudo
    extract
    colored-man-pages
    docker
    docker-compose
    npm
    history-substring-search
    zsh-autosuggestions
    zsh-syntax-highlighting
    fzf
)

# Source Oh My Zsh
source $ZSH/oh-my-zsh.sh

# -----------------------------------------------------------------------------
# Powerlevel10k Theme
# -----------------------------------------------------------------------------

# Theme loading based on platform detection (set in ~/.zshenv)
if [[ "$DOTFILES_IS_OMARCHY" == "1" ]]; then
    # Omarchy - use bundled powerlevel10k if available, else system
    if [[ -f "${DOTFILES_OMARCHY_HOME:-$HOME/.local/share/omarchy}/zsh/plugins/powerlevel10k/powerlevel10k.zsh-theme" ]]; then
        source "${DOTFILES_OMARCHY_HOME}/zsh/plugins/powerlevel10k/powerlevel10k.zsh-theme"
    elif [[ -f "/usr/share/zsh-theme-powerlevel10k/powerlevel10k.zsh-theme" ]]; then
        source /usr/share/zsh-theme-powerlevel10k/powerlevel10k.zsh-theme
    fi
elif [[ "$DOTFILES_IS_ARCH" == "1" ]]; then
    # Arch Linux - pacman/yay installation
    if [[ -f "/usr/share/zsh-theme-powerlevel10k/powerlevel10k.zsh-theme" ]]; then
        source /usr/share/zsh-theme-powerlevel10k/powerlevel10k.zsh-theme
    fi
elif [[ "$(uname)" == "Darwin" ]]; then
    # macOS - Homebrew installation
    if [[ -f "$(brew --prefix)/share/powerlevel10k/powerlevel10k.zsh-theme" ]]; then
        source "$(brew --prefix)/share/powerlevel10k/powerlevel10k.zsh-theme"
    fi
fi

# Load powerlevel10k configuration if it exists
[[ -f "$HOME/.p10k.zsh" ]] && source "$HOME/.p10k.zsh"

# -----------------------------------------------------------------------------
# History Configuration
# -----------------------------------------------------------------------------

# Share history across sessions
setopt SHARE_HISTORY           # Share history between all sessions
setopt APPEND_HISTORY          # Append to history file, not overwrite
setopt INC_APPEND_HISTORY      # Add commands to history immediately

# History settings
setopt HIST_IGNORE_DUPS        # Don't record duplicate entries
setopt HIST_IGNORE_SPACE       # Don't record commands starting with space
setopt HIST_REDUCE_BLANKS      # Remove superfluous blanks

# -----------------------------------------------------------------------------
# Additional Key Bindings
# -----------------------------------------------------------------------------

# Bindings for history-substring-search (must be after sourcing Oh My Zsh)
bindkey '^[[A' history-substring-search-up
bindkey '^[[B' history-substring-search-down

# -----------------------------------------------------------------------------
# Aliases
# -----------------------------------------------------------------------------

# General aliases
alias ls='ls --color=auto'
alias ll='ls -la'
alias la='ls -A'
alias l='ls -CF'
alias cls='clear'

# Git aliases (additional to Oh My Zsh git plugin)
alias glog='git log --oneline --graph --decorate'
alias gst='git status'
alias gdiff='git diff'

# Editor aliases
alias v='nvim'
alias vim='nvim'

# -----------------------------------------------------------------------------
# fzf Configuration
# -----------------------------------------------------------------------------

# fzf key bindings (Ctrl+T, Ctrl+R, Alt+C) - enabled via plugin
# Default command uses fd if available
if command -v fd >/dev/null 2>&1; then
    export FZF_DEFAULT_COMMAND='fd --type f --hidden --follow --exclude .git'
    export FZF_CTRL_T_COMMAND="$FZF_DEFAULT_COMMAND"
    export FZF_ALT_C_COMMAND='fd --type d --hidden --follow --exclude .git'
fi

# fzf preview with bat if available
if command -v bat >/dev/null 2>&1; then
    export FZF_CTRL_T_OPTS="--preview 'bat --style=numbers --color=always {} 2>/dev/null || cat {}' --preview-window=~3 --cycle"
fi

# -----------------------------------------------------------------------------
# Additional Settings
# -----------------------------------------------------------------------------

# Enable bash-style comments in interactive shell
setopt INTERACTIVE_COMMENTS

# Change directory without cd
setopt AUTO_CD

# Extended globbing
setopt EXTENDED_GLOB

# No beep
unsetopt BEEP

# Completion styling
zstyle ':completion:*' menu select
zstyle ':completion:*' matcher-list 'm:{a-zA-Z}={A-Za-z}'

# Auto-correction
setopt CORRECT

# -----------------------------------------------------------------------------
# Local Overrides
# -----------------------------------------------------------------------------

# Source local zshrc overrides if it exists (use for machine-specific config)
[[ -f "$HOME/.zshrc.local" ]] && source "$HOME/.zshrc.local"

# To customize prompt, run `p10k configure` or edit ~/.p10k.zsh.
[[ ! -f ~/.p10k.zsh ]] || source ~/.p10k.zsh

# OpenClaw Completion
source "/home/recreation/.openclaw/completions/openclaw.zsh"
