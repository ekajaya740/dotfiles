#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=bootstrap/lib.sh
source "${SCRIPT_DIR}/lib.sh"
# shellcheck source=bootstrap/tools.sh
source "${SCRIPT_DIR}/tools.sh"

log_info "Running Debian-based bootstrap"

if ! command -v apt-get >/dev/null 2>&1; then
  log_error "apt-get not found. Unable to install stow automatically."
  exit 1
fi

ensure_bootstrap_tools

link_dotfiles "$@"
