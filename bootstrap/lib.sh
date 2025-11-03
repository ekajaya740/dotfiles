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
  local root path
  root="${DOTFILES_ROOT:-.}"
  while IFS= read -r -d '' path; do
    basename "$path"
  done < <(find "$root" -mindepth 1 -maxdepth 1 -type d \
    ! -name ".git" ! -name "bootstrap" -print0)
  local extra_files=(
    ".tmux.conf"
    ".zshrc"
    ".zprofile"
    ".zshenv"
    ".p10k.zsh"
  )
  local extra
  for extra in "${extra_files[@]}"; do
    if [[ -e "${root}/${extra}" ]]; then
      echo "$extra"
    fi
  done
}

link_dotfiles() {
  local force_override="${BOOTSTRAP_FORCE:-${BOOTSTRAP_FORCE_OVERRIDE:-0}}"
  local packages=()
  local arg

  while [[ $# -gt 0 ]]; do
    arg="$1"
    case "$arg" in
      --force|--override)
        force_override=1
        ;;
      --no-force)
        force_override=0
        ;;
      --)
        shift
        packages+=("$@")
        break
        ;;
      -*)
        log_error "Unknown option '${arg}' for link_dotfiles."
        exit 1
        ;;
      *)
        packages+=("$arg")
        ;;
    esac
    shift || break
  done

  case "$force_override" in
    1|true|TRUE|yes|YES|on|ON)
      force_override=1
      ;;
    *)
      force_override=0
      ;;
  esac

  if [[ ${#packages[@]} -eq 0 ]]; then
    if [[ -n "${STOW_PACKAGES:-}" ]]; then
      # shellcheck disable=SC2206
      packages=(${STOW_PACKAGES})
    else
      local pkg_name
      if builtin mapfile >/dev/null 2>&1; then
        mapfile -t packages < <(default_stow_packages)
      else
        while IFS= read -r pkg_name; do
          packages+=("$pkg_name")
        done < <(default_stow_packages)
      fi
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

  local target_dir="${STOW_TARGET:-$HOME}"
  mkdir -p "$target_dir"
  mkdir -p "${target_dir}/.config"

  log_info "Linking packages into ${target_dir}: ${packages[*]}"

  local dotfiles_root="${DOTFILES_ROOT:-.}"
  local stow_packages=()
  local manual_links=()
  local pkg pkg_path
  for pkg in "${packages[@]}"; do
    pkg_path="${dotfiles_root}/${pkg}"
    if [[ -d "$pkg_path" ]]; then
      stow_packages+=("$pkg")
    elif [[ -f "$pkg_path" ]]; then
      manual_links+=("$pkg")
    else
      log_error "Package '${pkg}' not found in ${dotfiles_root}."
      return 1
    fi
  done

  if [[ ${#stow_packages[@]} -gt 0 ]]; then
    local stow_cmd=(stow --dotfiles --dir "${dotfiles_root}" --target "$target_dir" --restow "${stow_packages[@]}")
    local output

    if [[ "$force_override" -eq 1 ]]; then
      if output=$("${stow_cmd[@]}" 2>&1); then
        [[ -n "$output" ]] && printf '%s\n' "$output"
      else
        local conflicts=()
        while IFS= read -r line; do
          if [[ "$line" =~ over\ existing\ target\ (.+)\ since ]]; then
            conflicts+=("${BASH_REMATCH[1]}")
          elif [[ "$line" =~ existing\ target\ is\ not\ owned\ by\ stow:\ (.+) ]]; then
            conflicts+=("${BASH_REMATCH[1]}")
          elif [[ "$line" == "  * existing target is stowed to a different package: "* ]]; then
            local conflict_target
            conflict_target="${line#*: }"
            conflict_target="${conflict_target%% => *}"
            conflicts+=("$conflict_target")
          fi
        done <<< "$output"

        if [[ ${#conflicts[@]} -eq 0 ]]; then
          printf '%s\n' "$output" >&2
          return 1
        fi

        local conflict path_full trimmed_target
        trimmed_target="${target_dir%/}"
        for conflict in "${conflicts[@]}"; do
          if [[ -z "$conflict" || "$conflict" == "." || "$conflict" == ".." || "$conflict" == /* || "$conflict" == *"../"* ]]; then
            log_error "Refusing to remove suspicious conflict path '$conflict'."
            printf '%s\n' "$output" >&2
            return 1
          fi

          if [[ -n "$trimmed_target" ]]; then
            path_full="${trimmed_target}/${conflict}"
          else
            path_full="/${conflict}"
          fi

          if [[ -e "$path_full" || -L "$path_full" ]]; then
            log_warn "Removing conflicting path ${path_full} (force override)."
            rm -rf -- "$path_full"
          fi
        done

        if output=$("${stow_cmd[@]}" 2>&1); then
          [[ -n "$output" ]] && printf '%s\n' "$output"
        else
          printf '%s\n' "$output" >&2
          return 1
        fi
      fi
    else
      "${stow_cmd[@]}"
    fi
  fi

  if [[ ${#manual_links[@]} -gt 0 ]]; then
    local link_target link_source trimmed_target target_path
    trimmed_target="${target_dir%/}"
    for link_target in "${manual_links[@]}"; do
      link_source="${dotfiles_root}/${link_target}"
      if [[ -n "$trimmed_target" ]]; then
        target_path="${trimmed_target}/${link_target}"
      else
        target_path="${link_target}"
      fi

      if [[ -e "$target_path" || -L "$target_path" ]]; then
        if [[ -L "$target_path" ]]; then
          local existing_link
          existing_link="$(readlink "$target_path")"
          if [[ "$existing_link" == "$link_source" ]]; then
            continue
          fi
        fi
        if [[ "$force_override" -eq 1 ]]; then
          log_warn "Removing conflicting path ${target_path} (force override)."
          rm -rf -- "$target_path"
        else
          log_error "Refusing to overwrite existing path ${target_path}. Use --force to override."
          return 1
        fi
      fi

      mkdir -p "$(dirname "$target_path")"
      ln -s "$link_source" "$target_path"
    done
  fi
}
