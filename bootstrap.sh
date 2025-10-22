#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_PATH="${SCRIPT_DIR}/bootstrap/lib.sh"

if [[ ! -f "$LIB_PATH" ]]; then
  printf 'bootstrap: missing helper library at %s\n' "$LIB_PATH" >&2
  exit 1
fi

# shellcheck source=bootstrap/lib.sh
source "$LIB_PATH"

main() {
  local os_id handler
  local skip_tools_flag=0
  local handler_args=()

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --skip-tools|--no-tools)
        skip_tools_flag=1
        ;;
      *)
        handler_args+=("$1")
        ;;
    esac
    shift
  done

  if (( skip_tools_flag )); then
    export BOOTSTRAP_SKIP_TOOLS=1
  fi

  os_id="$(detect_os)"
  if [[ "$os_id" == "unknown" ]]; then
    log_error "Unsupported or undetected platform. Specify STOW_PACKAGES and run stow manually."
    exit 1
  fi

  handler="${SCRIPT_DIR}/bootstrap/${os_id}.sh"
  if [[ ! -x "$handler" ]]; then
    log_error "No handler for platform '${os_id}' (${handler})."
    exit 1
  fi

  export DOTFILES_ROOT="${SCRIPT_DIR}"
  exec "$handler" "${handler_args[@]}"
}

main "$@"
