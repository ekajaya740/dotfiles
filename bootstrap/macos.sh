#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=bootstrap/lib.sh
source "${SCRIPT_DIR}/lib.sh"
# shellcheck source=bootstrap/tools.sh
source "${SCRIPT_DIR}/tools.sh"

log_info "Running macOS bootstrap"

if ! command -v brew >/dev/null 2>&1; then
  log_error "Homebrew not found. Install it from https://brew.sh/ and re-run."
  exit 1
fi

ensure_bootstrap_tools

link_dotfiles "$@"
