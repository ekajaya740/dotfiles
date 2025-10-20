#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=bootstrap/lib.sh
source "${SCRIPT_DIR}/lib.sh"

log_info "Running generic Linux bootstrap"

install_stow_generic() {
  if command -v apt-get >/dev/null 2>&1; then
    log_info "Installing GNU stow via apt-get"
    run_with_privilege apt-get update
    run_with_privilege apt-get install -y stow
    return 0
  fi

  if command -v pacman >/dev/null 2>&1; then
    log_info "Installing GNU stow via pacman"
    run_with_privilege pacman -Sy --needed --noconfirm stow
    return 0
  fi

  if command -v dnf >/dev/null 2>&1; then
    log_info "Installing GNU stow via dnf"
    run_with_privilege dnf install -y stow
    return 0
  fi

  if command -v zypper >/dev/null 2>&1; then
    log_info "Installing GNU stow via zypper"
    run_with_privilege zypper install -y stow
    return 0
  fi

  if command -v xbps-install >/dev/null 2>&1; then
    log_info "Installing GNU stow via xbps-install"
    run_with_privilege xbps-install -Sy stow
    return 0
  fi

  return 1
}

if ! command -v stow >/dev/null 2>&1; then
  if ! install_stow_generic; then
    log_warn "Unable to install stow automatically. Install it via your package manager and re-run."
    exit 1
  fi
else
  log_info "stow already present"
fi

link_dotfiles "$@"
