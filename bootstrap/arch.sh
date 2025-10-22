#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=bootstrap/lib.sh
source "${SCRIPT_DIR}/lib.sh"
# shellcheck source=bootstrap/tools.sh
source "${SCRIPT_DIR}/tools.sh"

log_info "Running Arch-based bootstrap"

if ! command -v pacman >/dev/null 2>&1; then
  log_error "pacman not found. Unable to install stow automatically."
  exit 1
fi

ensure_bootstrap_tools

link_dotfiles "$@"
