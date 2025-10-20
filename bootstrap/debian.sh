#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=bootstrap/lib.sh
source "${SCRIPT_DIR}/lib.sh"

log_info "Running Debian-based bootstrap"

if ! command -v apt-get >/dev/null 2>&1; then
  log_error "apt-get not found. Unable to install stow automatically."
  exit 1
fi

if ! command -v stow >/dev/null 2>&1; then
  log_info "Installing GNU stow via apt-get"
  run_with_privilege apt-get update
  run_with_privilege apt-get install -y stow
else
  log_info "stow already present"
fi

link_dotfiles "$@"
