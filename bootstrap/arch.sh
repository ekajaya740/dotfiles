#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=bootstrap/lib.sh
source "${SCRIPT_DIR}/lib.sh"

log_info "Running Arch-based bootstrap"

if ! command -v pacman >/dev/null 2>&1; then
  log_error "pacman not found. Unable to install stow automatically."
  exit 1
fi

if ! command -v stow >/dev/null 2>&1; then
  log_info "Installing GNU stow via pacman"
  run_with_privilege pacman -Sy --needed --noconfirm stow
else
  log_info "stow already present"
fi

link_dotfiles "$@"
