#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=bootstrap/lib.sh
source "${SCRIPT_DIR}/lib.sh"
# shellcheck source=bootstrap/tools.sh
source "${SCRIPT_DIR}/tools.sh"

log_info "Running generic Linux bootstrap"

if ! ensure_bootstrap_tools; then
  if ! command -v stow >/dev/null 2>&1; then
    log_error "Unable to install stow automatically. Install it via your package manager and re-run."
    exit 1
  fi
fi

link_dotfiles "$@"
