#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BOOTSTRAP_LIB="${ROOT_DIR}/bootstrap/lib.sh"
BASH_BIN="${BASH:-$(command -v bash)}"

if [[ ! -f "$BOOTSTRAP_LIB" ]]; then
  printf 'Unable to locate bootstrap library at %s\n' "$BOOTSTRAP_LIB" >&2
  exit 1
fi

if [[ -z "$BASH_BIN" ]]; then
  printf 'Unable to locate bash interpreter\n' >&2
  exit 1
fi

PASS_COUNT=0
FAIL_COUNT=0
TMP_DIRS=()

cleanup() {
  local dir
  for dir in "${TMP_DIRS[@]}"; do
    [[ -d "$dir" ]] && rm -rf "$dir"
  done
}
trap cleanup EXIT

run_test() {
  local name="$1"
  local expected_exit="$2"
  local script="$3"
  local output
  local status

  set +e
  output=$(printf '%s\n' "$script" | "$BASH_BIN" -s -- "$BOOTSTRAP_LIB" 2>&1)
  status=$?
  set -e

  if [[ "$status" -eq "$expected_exit" ]]; then
    printf 'PASS %s\n' "$name"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    printf 'FAIL %s (expected %s got %s)\n' "$name" "$expected_exit" "$status" >&2
    if [[ -n "$output" ]]; then
      printf '%s\n' "$output" >&2
    fi
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

macos_detect_script=$(cat <<'EOF'
set -euo pipefail
source "$1"
[[ "$(detect_os)" == "macos" ]]
EOF
)
BOOTSTRAP_UNAME_S=Darwin run_test "detect_os_macos" 0 "$macos_detect_script"

arch_detect_script=$(cat <<'EOF'
set -euo pipefail
source "$1"
[[ "$(detect_os)" == "arch" ]]
EOF
)
arch_tmp="$(mktemp -d)"
TMP_DIRS+=("$arch_tmp")
cat > "${arch_tmp}/os-release" <<'EOF'
ID=arch
EOF
BOOTSTRAP_UNAME_S=Linux BOOTSTRAP_OS_RELEASE="${arch_tmp}/os-release" run_test "detect_os_arch" 0 "$arch_detect_script"

id_like_detect_script=$(cat <<'EOF'
set -euo pipefail
source "$1"
[[ "$(detect_os)" == "arch" ]]
EOF
)
id_like_tmp="$(mktemp -d)"
TMP_DIRS+=("$id_like_tmp")
cat > "${id_like_tmp}/os-release" <<'EOF'
ID=manjaro
ID_LIKE=arch
EOF
BOOTSTRAP_UNAME_S=Linux BOOTSTRAP_OS_RELEASE="${id_like_tmp}/os-release" run_test "detect_os_arch_via_like" 0 "$id_like_detect_script"

wsl_detect_script=$(cat <<'EOF'
set -euo pipefail
source "$1"
[[ "$(detect_os)" == "windows-wsl" ]]
EOF
)
BOOTSTRAP_UNAME_S=Linux BOOTSTRAP_PROC_VERSION="Linux version 5.15.90.1-microsoft-standard-WSL2" run_test "detect_os_wsl" 0 "$wsl_detect_script"

windows_msys_script=$(cat <<'EOF'
set -euo pipefail
source "$1"
[[ "$(detect_os)" == "windows-msys" ]]
EOF
)
BOOTSTRAP_UNAME_S=MINGW64_NT-10.0 run_test "detect_os_windows_msys" 0 "$windows_msys_script"

skip_tools_script=$(cat <<'EOF'
set -euo pipefail
source "$1"
tools_path="$(dirname "$1")/tools.sh"
source "$tools_path"
BOOTSTRAP_SKIP_TOOLS=1 ensure_bootstrap_tools
EOF
)
skip_tmp="$(mktemp -d)"
TMP_DIRS+=("$skip_tmp")
cat > "${skip_tmp}/stow" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "${skip_tmp}/stow"
PATH="${skip_tmp}:${PATH}" run_test "ensure_bootstrap_tools_skip_flag" 0 "$skip_tools_script"

nvm_skip_install_script=$(cat <<'EOF'
set -euo pipefail
source "$1"
tools_path="$(dirname "$1")/tools.sh"
source "$tools_path"
ensure_nvm
EOF
)
nvm_tmp="$(mktemp -d)"
TMP_DIRS+=("$nvm_tmp")
cat > "${nvm_tmp}/nvm" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  install|alias|use)
    exit 0
    ;;
esac
exit 0
EOF
chmod +x "${nvm_tmp}/nvm"
PATH="${nvm_tmp}:${PATH}" run_test "ensure_nvm_skips_install_when_available" 0 "$nvm_skip_install_script"

linux_fallback_script=$(cat <<'EOF'
set -euo pipefail
source "$1"
[[ "$(detect_os)" == "linux" ]]
EOF
)
linux_tmp="$(mktemp -d)"
TMP_DIRS+=("$linux_tmp")
cat > "${linux_tmp}/os-release" <<'EOF'
ID=unknownos
EOF
BOOTSTRAP_UNAME_S=Linux BOOTSTRAP_OS_RELEASE="${linux_tmp}/os-release" run_test "detect_os_linux_fallback" 0 "$linux_fallback_script"

unknown_detect_script=$(cat <<'EOF'
set -euo pipefail
source "$1"
[[ "$(detect_os)" == "unknown" ]]
EOF
)
BOOTSTRAP_UNAME_S="SomethingElse" run_test "detect_os_unknown" 0 "$unknown_detect_script"

link_default_script=$(cat <<'EOF'
set -euo pipefail
source "$1"
link_dotfiles
args=()
while IFS= read -r line; do
  args+=("$line")
done < "$STOW_STUB_OUTPUT"
[[ "${args[0]}" == "--dotfiles" ]]
[[ "${args[1]}" == "--dir" ]]
[[ "${args[2]}" == "$DOTFILES_ROOT" ]]
[[ "${args[3]}" == "--target" ]]
[[ "${args[4]}" == "$STOW_TARGET" ]]
[[ "${args[5]}" == "--restow" ]]
[[ -d "$STOW_TARGET" ]]
args_joined=" ${args[*]} "
[[ "$args_joined" == *" nvim "* ]]
target="${STOW_TARGET}/.tmux.conf"
[[ -L "$target" ]]
[[ "$(readlink "$target")" == "${DOTFILES_ROOT}/.tmux.conf" ]]
EOF
)
link_tmp="$(mktemp -d)"
TMP_DIRS+=("$link_tmp")
mkdir -p "${link_tmp}/root/nvim/.config/nvim" "${link_tmp}/root/bootstrap"
touch "${link_tmp}/root/.tmux.conf"
mkdir -p "${link_tmp}/bin"
cat > "${link_tmp}/bin/stow" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
mode="${STOW_STUB_MODE:-record}"
case "$mode" in
  conflict)
    conflict_path="${STOW_FORCE_TARGET:-}"
    if [[ -n "$conflict_path" && ( -e "$conflict_path" || -L "$conflict_path" ) ]]; then
      pkg="${@: -1}"
      target_rel="${STOW_FORCE_TARGET_REL:-$(basename "$conflict_path")}"
      printf 'WARNING! stowing %s would cause conflicts:\n' "$pkg" >&2
      conflict_type="${STOW_FORCE_CONFLICT_TYPE:-not_owned}"
      case "$conflict_type" in
        different_package)
          alt_target="${STOW_FORCE_ALT_TARGET:-../other/.placeholder}"
          printf '  * existing target is stowed to a different package: %s => %s\n' "$target_rel" "$alt_target" >&2
          ;;
        *)
          printf '  * existing target is not owned by stow: %s\n' "$target_rel" >&2
          ;;
      esac
      exit 1
    fi
    ;;
esac

printf '%s\n' "$@" > "$STOW_STUB_OUTPUT"
EOF
chmod +x "${link_tmp}/bin/stow"
export PATH="${link_tmp}/bin:${PATH}"
export DOTFILES_ROOT="${link_tmp}/root"
export STOW_TARGET="${link_tmp}/target"
export STOW_STUB_OUTPUT="${link_tmp}/stow_args.txt"
run_test "link_dotfiles_defaults" 0 "$link_default_script"

link_custom_script=$(cat <<'EOF'
set -euo pipefail
source "$1"
link_dotfiles
args=()
while IFS= read -r line; do
  args+=("$line")
done < "$STOW_STUB_OUTPUT"
count=${#args[@]}
[[ $count -ge 1 ]]
[[ "${args[count-1]}" == "nvim" ]]
target="${STOW_TARGET}/.tmux.conf"
[[ -L "$target" ]]
[[ "$(readlink "$target")" == "${DOTFILES_ROOT}/.tmux.conf" ]]
EOF
)
export STOW_STUB_OUTPUT="${link_tmp}/stow_custom.txt"
export STOW_PACKAGES="nvim .tmux.conf"
run_test "link_dotfiles_custom_packages" 0 "$link_custom_script"
unset STOW_PACKAGES

link_force_script=$(cat <<'EOF'
set -euo pipefail
source "$1"
link_dotfiles --force .tmux.conf
target="${STOW_TARGET}/.tmux.conf"
[[ -L "$target" ]]
[[ "$(readlink "$target")" == "${DOTFILES_ROOT}/.tmux.conf" ]]
EOF
)
mkdir -p "$STOW_TARGET"
rm -f "${STOW_TARGET}/.tmux.conf"
printf 'existing' > "${STOW_TARGET}/.tmux.conf"
touch "${DOTFILES_ROOT}/.tmux.conf"
run_test "link_dotfiles_force_overrides_conflicts" 0 "$link_force_script"

link_force_other_pkg_script=$(cat <<'EOF'
set -euo pipefail
source "$1"
link_dotfiles --force nvim
[[ ! -e "$STOW_FORCE_TARGET" ]]
[[ ! -L "$STOW_FORCE_TARGET" ]]
EOF
)
export STOW_STUB_MODE="conflict"
export STOW_FORCE_TARGET="${STOW_TARGET}/.config/nvim/init.lua"
export STOW_FORCE_TARGET_REL=".config/nvim/init.lua"
export STOW_FORCE_CONFLICT_TYPE="different_package"
export STOW_FORCE_ALT_TARGET="../root/other/.config/nvim/init.lua"
mkdir -p "$(dirname "$STOW_FORCE_TARGET")"
ln -s "../root/other/.config/nvim/init.lua" "$STOW_FORCE_TARGET"
run_test "link_dotfiles_force_handles_other_package_conflict" 0 "$link_force_other_pkg_script"
unset STOW_STUB_MODE STOW_FORCE_TARGET STOW_FORCE_TARGET_REL STOW_FORCE_CONFLICT_TYPE STOW_FORCE_ALT_TARGET

missing_stow_script=$(cat <<'EOF'
set -euo pipefail
source "$1"
link_dotfiles
EOF
)
nostow_tmp="$(mktemp -d)"
TMP_DIRS+=("$nostow_tmp")
for cmd in find basename mkdir; do
  cmd_path="$(command -v "$cmd" || true)"
  if [[ -n "$cmd_path" && ! -e "${nostow_tmp}/${cmd}" ]]; then
    ln -s "$cmd_path" "${nostow_tmp}/${cmd}"
  fi
done
PATH="$nostow_tmp" DOTFILES_ROOT="${link_tmp}/root" STOW_TARGET="${link_tmp}/target" run_test "link_dotfiles_missing_stow" 1 "$missing_stow_script"

printf '\nSummary: %s passed, %s failed\n' "$PASS_COUNT" "$FAIL_COUNT"

if [[ "$FAIL_COUNT" -ne 0 ]]; then
  exit 1
fi
