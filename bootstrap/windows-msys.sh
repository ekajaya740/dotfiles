#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=bootstrap/lib.sh
source "${SCRIPT_DIR}/lib.sh"

log_info "Running Windows (MSYS/Cygwin) bootstrap"

install_stow() {
  if command -v pacman >/dev/null 2>&1; then
    log_info "Installing GNU stow via pacman"
    pacman -Sy --needed --noconfirm stow
    return 0
  fi

  if command -v choco.exe >/dev/null 2>&1; then
    log_info "Installing GNU stow via Chocolatey"
    choco.exe install -y stow
    return 0
  fi

  return 1
}

if ! command -v stow >/dev/null 2>&1; then
  if ! install_stow; then
    log_error "Could not find a supported package manager (pacman/choco). Install stow manually and re-run."
    exit 1
  fi
else
  log_info "stow already present"
fi

link_dotfiles "$@"
