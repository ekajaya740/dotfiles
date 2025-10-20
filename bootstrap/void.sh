#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=bootstrap/lib.sh
source "${SCRIPT_DIR}/lib.sh"

log_info "Running Void Linux bootstrap"

if ! command -v xbps-install >/dev/null 2>&1; then
  log_error "xbps-install not found. Unable to install stow automatically."
  exit 1
fi

if ! command -v stow >/dev/null 2>&1; then
  log_info "Installing GNU stow via XBPS"
  run_with_privilege xbps-install -Sy stow
else
  log_info "stow already present"
fi

link_dotfiles "$@"
