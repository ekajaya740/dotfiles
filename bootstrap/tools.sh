#!/usr/bin/env bash
set -euo pipefail

# Helper functions to install common tooling across platforms.
# Requires bootstrap/lib.sh to be sourced first (for logging helpers and run_with_privilege).

# tree-sitter-cli added because nvim-treesitter needs the CLI binary available.
DEFAULT_BOOTSTRAP_TOOLS=(stow tree-sitter-cli hadolint fzf lazygit lazydocker tmux neovim powerlevel10k)

APT_UPDATED=0
APT_AVAILABLE=1

ensure_tool_installed() {
  local tool="$1"
  local package="${2:-$tool}"
  local binary="${3:-$tool}"
  local installed=0

  if command -v "$binary" >/dev/null 2>&1; then
    return 0
  fi

  if command -v brew >/dev/null 2>&1; then
    log_info "Installing ${package} via Homebrew"
    if brew install "$package"; then
      installed=1
    else
      log_warn "Homebrew install failed for ${package}"
    fi
  fi

  if (( ! installed )) && command -v apt-get >/dev/null 2>&1 && (( APT_AVAILABLE )); then
    if (( ! APT_UPDATED )); then
      log_info "Updating apt package index"
      if run_with_privilege apt-get update; then
        APT_UPDATED=1
      else
        log_warn "apt-get update failed; skipping further apt installs"
        APT_AVAILABLE=0
      fi
    fi

    if (( APT_AVAILABLE )); then
      log_info "Installing ${package} via apt-get"
      if run_with_privilege apt-get install -y "$package"; then
        installed=1
      else
        log_warn "apt-get install failed for ${package}"
      fi
    fi
  fi

  if (( ! installed )) && command -v pacman >/dev/null 2>&1; then
    log_info "Installing ${package} via pacman"
    if pacman -Sy --needed --noconfirm "$package"; then
      installed=1
    elif run_with_privilege pacman -Sy --needed --noconfirm "$package"; then
      installed=1
    else
      log_warn "pacman install failed for ${package}"
    fi
  fi

  if (( ! installed )) && command -v yay >/dev/null 2>&1; then
    log_info "Installing ${package} via yay"
    if yay -Sy --needed --noconfirm "$package"; then
      installed=1
    else
      log_warn "yay install failed for ${package}"
    fi
  fi

  if (( ! installed )) && command -v paru >/dev/null 2>&1; then
    log_info "Installing ${package} via paru"
    if paru -Sy --needed --noconfirm "$package"; then
      installed=1
    else
      log_warn "paru install failed for ${package}"
    fi
  fi

  if (( ! installed )) && command -v xbps-install >/dev/null 2>&1; then
    log_info "Installing ${package} via xbps-install"
    if run_with_privilege xbps-install -Sy "$package"; then
      installed=1
    else
      log_warn "xbps-install failed for ${package}"
    fi
  fi

  if (( ! installed )) && command -v dnf >/dev/null 2>&1; then
    log_info "Installing ${package} via dnf"
    if run_with_privilege dnf install -y "$package"; then
      installed=1
    else
      log_warn "dnf install failed for ${package}"
    fi
  fi

  if (( ! installed )) && command -v zypper >/dev/null 2>&1; then
    log_info "Installing ${package} via zypper"
    if run_with_privilege zypper install -y "$package"; then
      installed=1
    else
      log_warn "zypper install failed for ${package}"
    fi
  fi

  if (( ! installed )) && command -v choco.exe >/dev/null 2>&1; then
    log_info "Installing ${package} via Chocolatey"
    if choco.exe install -y "$package"; then
      installed=1
    else
      log_warn "Chocolatey install failed for ${package}"
    fi
  fi

  if (( ! installed )) && command -v winget >/dev/null 2>&1; then
    log_info "Installing ${package} via winget"
    if winget install --silent --accept-source-agreements --accept-package-agreements "$package"; then
      installed=1
    else
      log_warn "winget install failed for ${package}"
    fi
  fi

  if (( ! installed )); then
    if command -v "$binary" >/dev/null 2>&1; then
      return 0
    fi
    log_warn "Unable to install ${package}. Please install it manually."
    return 1
  fi

  if command -v "$binary" >/dev/null 2>&1; then
    return 0
  fi

  log_warn "${package} installation completed but ${binary} not found on PATH."
  return 1
}

ensure_tree_sitter_cli() {
  local installed=0

  if command -v tree-sitter >/dev/null 2>&1; then
    return 0
  fi

  if command -v brew >/dev/null 2>&1; then
    log_info "Installing tree-sitter CLI via Homebrew"
    if brew install tree-sitter-cli; then
      installed=1
    elif brew install tree-sitter; then
      installed=1
    else
      log_warn "Homebrew install failed for tree-sitter CLI"
    fi
  fi

  if (( ! installed )) && command -v apt-get >/dev/null 2>&1 && (( APT_AVAILABLE )); then
    if (( ! APT_UPDATED )); then
      log_info "Updating apt package index"
      if run_with_privilege apt-get update; then
        APT_UPDATED=1
      else
        log_warn "apt-get update failed; skipping further apt installs"
        APT_AVAILABLE=0
      fi
    fi

    if (( APT_AVAILABLE )); then
      log_info "Installing tree-sitter CLI via apt-get"
      if run_with_privilege apt-get install -y tree-sitter-cli; then
        installed=1
      else
        log_warn "apt-get install failed for tree-sitter-cli"
      fi
    fi
  fi

  if (( ! installed )) && command -v pacman >/dev/null 2>&1; then
    log_info "Installing tree-sitter CLI via pacman"
    if pacman -Sy --needed --noconfirm tree-sitter-cli; then
      installed=1
    elif run_with_privilege pacman -Sy --needed --noconfirm tree-sitter-cli; then
      installed=1
    else
      log_warn "pacman install failed for tree-sitter-cli"
    fi
  fi

  if (( ! installed )) && command -v yay >/dev/null 2>&1; then
    log_info "Installing tree-sitter CLI via yay"
    if yay -Sy --needed --noconfirm tree-sitter-cli; then
      installed=1
    else
      log_warn "yay install failed for tree-sitter-cli"
    fi
  fi

  if (( ! installed )) && command -v paru >/dev/null 2>&1; then
    log_info "Installing tree-sitter CLI via paru"
    if paru -Sy --needed --noconfirm tree-sitter-cli; then
      installed=1
    else
      log_warn "paru install failed for tree-sitter-cli"
    fi
  fi

  if (( ! installed )) && command -v xbps-install >/dev/null 2>&1; then
    log_info "Installing tree-sitter CLI via xbps-install"
    if run_with_privilege xbps-install -Sy tree-sitter; then
      installed=1
    elif run_with_privilege xbps-install -Sy tree-sitter-cli; then
      installed=1
    else
      log_warn "xbps-install failed for tree-sitter CLI"
    fi
  fi

  if (( ! installed )) && command -v dnf >/dev/null 2>&1; then
    log_info "Installing tree-sitter CLI via dnf"
    if run_with_privilege dnf install -y tree-sitter-cli; then
      installed=1
    elif run_with_privilege dnf install -y tree-sitter; then
      installed=1
    else
      log_warn "dnf install failed for tree-sitter CLI"
    fi
  fi

  if (( ! installed )) && command -v zypper >/dev/null 2>&1; then
    log_info "Installing tree-sitter CLI via zypper"
    if run_with_privilege zypper install -y tree-sitter-cli; then
      installed=1
    elif run_with_privilege zypper install -y tree-sitter; then
      installed=1
    else
      log_warn "zypper install failed for tree-sitter CLI"
    fi
  fi

  if (( ! installed )) && command -v choco.exe >/dev/null 2>&1; then
    log_info "Attempting to install tree-sitter CLI via Chocolatey"
    if choco.exe install -y tree-sitter; then
      installed=1
    else
      log_warn "Chocolatey install failed for tree-sitter"
    fi
  fi

  if (( ! installed )) && command -v winget >/dev/null 2>&1; then
    log_info "Attempting to install tree-sitter CLI via winget"
    if winget install --silent --accept-source-agreements --accept-package-agreements "tree-sitter.tree-sitter"; then
      installed=1
    elif winget install --silent --accept-source-agreements --accept-package-agreements "tree-sitter-cli"; then
      installed=1
    else
      log_warn "winget install failed for tree-sitter CLI"
    fi
  fi

  if (( ! installed )); then
    if command -v tree-sitter >/dev/null 2>&1; then
      return 0
    fi
    log_warn "Unable to install the tree-sitter CLI automatically. Install it manually for nvim-treesitter."
    return 1
  fi

  if command -v tree-sitter >/dev/null 2>&1; then
    return 0
  fi

  log_warn "tree-sitter package installed but CLI not found on PATH."
  return 1
}

powerlevel10k_theme_available() {
  local -a candidates=(
    "${HOME}/.oh-my-zsh/custom/themes/powerlevel10k/powerlevel10k.zsh-theme"
    "${HOME}/.local/share/zsh/themes/powerlevel10k/powerlevel10k.zsh-theme"
    "${HOME}/.local/share/zsh/plugins/powerlevel10k/powerlevel10k.zsh-theme"
    "${HOME}/.local/share/powerlevel10k/powerlevel10k.zsh-theme"
    "/usr/share/zsh-theme-powerlevel10k/powerlevel10k.zsh-theme"
    "/usr/share/zsh/plugins/powerlevel10k/powerlevel10k.zsh-theme"
    "/usr/share/powerlevel10k/powerlevel10k.zsh-theme"
    "/usr/local/share/powerlevel10k/powerlevel10k.zsh-theme"
    "/opt/local/share/powerlevel10k/powerlevel10k.zsh-theme"
    "/opt/local/share/zsh/site-functions/powerlevel10k.zsh-theme"
    "/opt/homebrew/share/powerlevel10k/powerlevel10k.zsh-theme"
    "/opt/homebrew/opt/powerlevel10k/share/powerlevel10k/powerlevel10k.zsh-theme"
  )
  local zsh_custom="${ZSH_CUSTOM:-}"
  if [[ -z "$zsh_custom" ]]; then
    zsh_custom="${HOME}/.oh-my-zsh/custom"
  fi
  if [[ -n "$zsh_custom" ]]; then
    candidates+=("${zsh_custom}/themes/powerlevel10k/powerlevel10k.zsh-theme")
  fi

  if command -v brew >/dev/null 2>&1; then
    local brew_prefix
    brew_prefix="$(brew --prefix 2>/dev/null || true)"
    if [[ -n "$brew_prefix" ]]; then
      candidates+=("${brew_prefix}/share/powerlevel10k/powerlevel10k.zsh-theme")
    fi
    if brew --prefix powerlevel10k >/dev/null 2>&1; then
      candidates+=("$(brew --prefix powerlevel10k)/share/powerlevel10k/powerlevel10k.zsh-theme")
    fi
  fi

  local candidate
  for candidate in "${candidates[@]}"; do
    if [[ -f "$candidate" ]]; then
      return 0
    fi
  done
  return 1
}

ensure_powerlevel10k() {
  if powerlevel10k_theme_available; then
    return 0
  fi

  local installed=0

  if command -v brew >/dev/null 2>&1; then
    log_info "Installing powerlevel10k via Homebrew"
    if brew install powerlevel10k; then
      installed=1
    else
      log_warn "Homebrew install failed for powerlevel10k"
    fi
  fi

  if (( ! installed )) && command -v apt-get >/dev/null 2>&1 && (( APT_AVAILABLE )); then
    if (( ! APT_UPDATED )); then
      log_info "Updating apt package index"
      if run_with_privilege apt-get update; then
        APT_UPDATED=1
      else
        log_warn "apt-get update failed; skipping further apt installs"
        APT_AVAILABLE=0
      fi
    fi

    if (( APT_AVAILABLE )); then
      local apt_pkg
      for apt_pkg in zsh-theme-powerlevel10k powerlevel10k; do
        log_info "Installing ${apt_pkg} via apt-get"
        if run_with_privilege apt-get install -y "$apt_pkg"; then
          installed=1
          break
        else
          log_warn "apt-get install failed for ${apt_pkg}"
        fi
      done
    fi
  fi

  if (( ! installed )) && command -v pacman >/dev/null 2>&1; then
    local pacman_pkg
    for pacman_pkg in zsh-theme-powerlevel10k powerlevel10k; do
      log_info "Installing ${pacman_pkg} via pacman"
      if pacman -Sy --needed --noconfirm "$pacman_pkg"; then
        installed=1
        break
      elif run_with_privilege pacman -Sy --needed --noconfirm "$pacman_pkg"; then
        installed=1
        break
      else
        log_warn "pacman install failed for ${pacman_pkg}"
      fi
    done
  fi

  if (( ! installed )) && command -v yay >/dev/null 2>&1; then
    log_info "Installing powerlevel10k via yay"
    if yay -Sy --needed --noconfirm powerlevel10k; then
      installed=1
    else
      log_warn "yay install failed for powerlevel10k"
    fi
  fi

  if (( ! installed )) && command -v paru >/dev/null 2>&1; then
    log_info "Installing powerlevel10k via paru"
    if paru -Sy --needed --noconfirm powerlevel10k; then
      installed=1
    else
      log_warn "paru install failed for powerlevel10k"
    fi
  fi

  if (( ! installed )) && command -v xbps-install >/dev/null 2>&1; then
    log_info "Installing powerlevel10k via xbps-install"
    if run_with_privilege xbps-install -Sy powerlevel10k; then
      installed=1
    else
      log_warn "xbps-install failed for powerlevel10k"
    fi
  fi

  if (( ! installed )) && command -v dnf >/dev/null 2>&1; then
    log_info "Installing powerlevel10k via dnf"
    if run_with_privilege dnf install -y powerlevel10k; then
      installed=1
    else
      log_warn "dnf install failed for powerlevel10k"
    fi
  fi

  if (( ! installed )) && command -v zypper >/dev/null 2>&1; then
    log_info "Installing powerlevel10k via zypper"
    if run_with_privilege zypper install -y powerlevel10k; then
      installed=1
    else
      log_warn "zypper install failed for powerlevel10k"
    fi
  fi

  if (( ! installed )); then
    if powerlevel10k_theme_available; then
      return 0
    fi
    log_warn "Unable to install powerlevel10k automatically. Install it manually via your plugin manager."
    return 1
  fi

  if powerlevel10k_theme_available; then
    return 0
  fi

  log_warn "powerlevel10k installation completed but theme files not found on expected paths."
  return 1
}

ensure_bootstrap_tools() {
  local tool
  local failed=0
  local tools=()
  local skip_tools="${BOOTSTRAP_SKIP_TOOLS:-0}"

  case "$skip_tools" in
    1|true|TRUE|yes|YES|on|ON)
      log_info "Skipping bootstrap tool installation (BOOTSTRAP_SKIP_TOOLS=${skip_tools})."
      if ! command -v stow >/dev/null 2>&1; then
        log_error "GNU stow is required but not available; install it or unset BOOTSTRAP_SKIP_TOOLS."
        return 1
      fi
      return 0
      ;;
  esac

  if [[ -n "${BOOTSTRAP_TOOLS:-}" ]]; then
    # shellcheck disable=SC2206
    tools=(${BOOTSTRAP_TOOLS})
  else
    tools=("${DEFAULT_BOOTSTRAP_TOOLS[@]}")
  fi

  for tool in "${tools[@]}"; do
    case "$tool" in
      tree-sitter-cli)
        if ! ensure_tree_sitter_cli; then
          failed=1
        fi
        continue
        ;;
      neovim)
        if ! ensure_tool_installed "$tool" "$tool" "nvim"; then
          failed=1
        fi
        continue
        ;;
      powerlevel10k)
        if ! ensure_powerlevel10k; then
          failed=1
        fi
        continue
        ;;
    esac
    if ! ensure_tool_installed "$tool"; then
      if [[ "$tool" == "stow" ]]; then
        failed=1
      fi
    fi
  done

  if ! command -v stow >/dev/null 2>&1; then
    log_error "GNU stow is required but could not be installed automatically."
    return 1
  fi

  if (( failed )); then
    return 1
  fi
  return 0
}
