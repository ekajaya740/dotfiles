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
mapfile -t args < "$STOW_STUB_OUTPUT"
[[ "${args[0]}" == "--dir" ]]
[[ "${args[1]}" == "$DOTFILES_ROOT" ]]
[[ "${args[2]}" == "--target" ]]
[[ "${args[3]}" == "$STOW_TARGET" ]]
[[ "${args[4]}" == "--restow" ]]
[[ -d "$STOW_TARGET" ]]
args_joined=" ${args[*]} "
[[ "$args_joined" == *" zsh "* ]]
[[ "$args_joined" == *" nvim "* ]]
EOF
)
link_tmp="$(mktemp -d)"
TMP_DIRS+=("$link_tmp")
mkdir -p "${link_tmp}/root/zsh" "${link_tmp}/root/nvim" "${link_tmp}/root/bootstrap"
mkdir -p "${link_tmp}/bin"
cat > "${link_tmp}/bin/stow" <<'EOF'
#!/usr/bin/env bash
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
mapfile -t args < "$STOW_STUB_OUTPUT"
[[ "${args[-2]}" == "vim" ]]
[[ "${args[-1]}" == "tmux" ]]
EOF
)
export STOW_STUB_OUTPUT="${link_tmp}/stow_custom.txt"
export STOW_PACKAGES="vim tmux"
run_test "link_dotfiles_custom_packages" 0 "$link_custom_script"
unset STOW_PACKAGES

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
