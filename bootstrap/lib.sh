#!/usr/bin/env bash
set -euo pipefail

log_info() {
  printf '[INFO] %s\n' "$*"
}

log_warn() {
  printf '[WARN] %s\n' "$*" >&2
}

log_error() {
  printf '[ERROR] %s\n' "$*" >&2
}

run_with_privilege() {
  if [[ $EUID -eq 0 ]]; then
    "$@"
    return
  fi
  if command -v sudo >/dev/null 2>&1; then
    sudo "$@"
    return
  fi
  log_error "Need elevated privileges to run: $*"
  exit 1
}

detect_os() {
  local uname_out id id_like os_release_file proc_version
  uname_out="${BOOTSTRAP_UNAME_S:-$(uname -s 2>/dev/null || echo "unknown")}"

  case "$uname_out" in
    Darwin)
      echo "macos"
      return
      ;;
    Linux)
      proc_version="${BOOTSTRAP_PROC_VERSION:-}"
      if [[ -z "$proc_version" ]]; then
        local proc_version_file="${BOOTSTRAP_PROC_VERSION_FILE:-/proc/version}"
        if [[ -r "$proc_version_file" ]]; then
          proc_version="$(<"$proc_version_file")"
        fi
      fi
      if [[ "$proc_version" =~ [Mm]icrosoft ]]; then
        echo "windows-wsl"
        return
      fi
      os_release_file="${BOOTSTRAP_OS_RELEASE:-/etc/os-release}"
      if [[ -r "$os_release_file" ]]; then
        # shellcheck disable=SC1091
        . "$os_release_file"
        id="${ID:-}"
        id_like="${ID_LIKE:-}"
        case "$id" in
          arch|artix) echo "arch"; return ;;
          debian) echo "debian"; return ;;
          ubuntu|linuxmint|pop) echo "debian"; return ;;
          void) echo "void"; return ;;
        esac
        case "$id_like" in
          *debian*) echo "debian"; return ;;
          *arch*) echo "arch"; return ;;
        esac
      fi
      echo "linux"
      return
      ;;
    MINGW*|MSYS*|CYGWIN*)
      echo "windows-msys"
      return
      ;;
  esac

  echo "unknown"
}

default_stow_packages() {
  local path
  while IFS= read -r -d '' path; do
    basename "$path"
  done < <(find "${DOTFILES_ROOT:-.}" -mindepth 1 -maxdepth 1 -type d \
    ! -name ".git" ! -name "bootstrap" -print0)
}

link_dotfiles() {
  local packages=("$@")

  if [[ ${#packages[@]} -eq 0 ]]; then
    if [[ -n "${STOW_PACKAGES:-}" ]]; then
      # shellcheck disable=SC2206
      packages=(${STOW_PACKAGES})
    else
      mapfile -t packages < <(default_stow_packages)
    fi
  fi

  if [[ ${#packages[@]} -eq 0 ]]; then
    log_warn "No stow packages found in ${DOTFILES_ROOT}."
    return 0
  fi

  if ! command -v stow >/dev/null 2>&1; then
    log_error "stow is not installed. Install it and re-run."
    exit 1
  fi

  mkdir -p "${STOW_TARGET:-$HOME}"

  log_info "Linking packages into ${STOW_TARGET:-$HOME}: ${packages[*]}"
  stow --dir "${DOTFILES_ROOT}" --target "${STOW_TARGET:-$HOME}" --restow "${packages[@]}"
}
