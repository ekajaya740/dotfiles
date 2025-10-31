# Use powerline prompt helpers when available.
USE_POWERLINE="true"
# Has weird character width
# Example:
#    is not a diamond
HAS_WIDECHARS="false"

# Source distro-provided zsh defaults when they exist (Manjaro, etc.).
if [[ -e /usr/share/zsh/manjaro-zsh-config ]]; then
  source /usr/share/zsh/manjaro-zsh-config
fi
if [[ -e /usr/share/zsh/manjaro-zsh-prompt ]]; then
  source /usr/share/zsh/manjaro-zsh-prompt
fi

# Locate powerlevel10k regardless of platform. Respect an existing override.
if [[ -z "${POWERLEVEL10K_THEME:-}" ]]; then
  typeset -a _p10k_candidates=(
    "/usr/share/zsh-theme-powerlevel10k/powerlevel10k.zsh-theme"
    "/usr/share/zsh/plugins/powerlevel10k/powerlevel10k.zsh-theme"
    "/usr/share/powerlevel10k/powerlevel10k.zsh-theme"
    "/usr/local/share/powerlevel10k/powerlevel10k.zsh-theme"
    "/opt/local/share/powerlevel10k/powerlevel10k.zsh-theme"
    "/opt/local/share/zsh/site-functions/powerlevel10k.zsh-theme"
    "/opt/homebrew/share/powerlevel10k/powerlevel10k.zsh-theme"
    "/opt/homebrew/opt/powerlevel10k/share/powerlevel10k/powerlevel10k.zsh-theme"
  )

  if command -v brew >/dev/null 2>&1; then
    typeset _brew_prefix
    _brew_prefix="$(brew --prefix 2>/dev/null || true)"
    if [[ -n "${_brew_prefix}" ]]; then
      _p10k_candidates+=("${_brew_prefix}/share/powerlevel10k/powerlevel10k.zsh-theme")
    fi
    typeset _brew_powerlevel_prefix
    _brew_powerlevel_prefix="$(brew --prefix powerlevel10k 2>/dev/null || true)"
    if [[ -n "${_brew_powerlevel_prefix}" ]]; then
      _p10k_candidates+=("${_brew_powerlevel_prefix}/share/powerlevel10k/powerlevel10k.zsh-theme")
    fi
  fi

  typeset _zsh_custom="${ZSH_CUSTOM:-${HOME}/.oh-my-zsh/custom}"
  if [[ -n "${_zsh_custom}" ]]; then
    _p10k_candidates+=("${_zsh_custom}/themes/powerlevel10k/powerlevel10k.zsh-theme")
  fi

  for _p10k_candidate in "${_p10k_candidates[@]}"; do
    if [[ -n "${_p10k_candidate}" && -f "${_p10k_candidate}" ]]; then
      POWERLEVEL10K_THEME="${_p10k_candidate}"
      break
    fi
  done

  unset _p10k_candidate _p10k_candidates _brew_prefix _brew_powerlevel_prefix _zsh_custom
fi

if [[ -n "${POWERLEVEL10K_THEME:-}" && -f "${POWERLEVEL10K_THEME}" ]]; then
  source "${POWERLEVEL10K_THEME}"
fi

if [[ -f "${HOME}/.p10k.zsh" ]]; then
  source "${HOME}/.p10k.zsh"
fi

#THIS MUST BE AT THE END OF THE FILE FOR SDKMAN TO WORK!!!
export SDKMAN_DIR="$HOME/.sdkman"
[[ -s "$HOME/.sdkman/bin/sdkman-init.sh" ]] && source "$HOME/.sdkman/bin/sdkman-init.sh"

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion
