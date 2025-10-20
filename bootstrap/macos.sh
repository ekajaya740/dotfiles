#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=bootstrap/lib.sh
source "${SCRIPT_DIR}/lib.sh"

log_info "Running macOS bootstrap"

if ! command -v brew >/dev/null 2>&1; then
  log_error "Homebrew not found. Install it from https://brew.sh/ and re-run."
  exit 1
fi

if ! command -v stow >/dev/null 2>&1; then
  log_info "Installing GNU stow via Homebrew"
  brew install stow
else
  log_info "stow already present"
fi

link_dotfiles "$@"
