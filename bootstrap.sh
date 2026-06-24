#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# bootstrap.sh — dotfiles installer for macOS, Arch, Debian/Ubuntu
# Uses GNU Stow to symlink everything under ~/dotfiles/
# ─────────────────────────────────────────────────────────────
set -euo pipefail
IFS=$'\n\t'

DOTFILES_REPO="${DOTFILES_REPO:-${HOME}/dotfiles}"
DOTFILES_URL="${DOTFILES_URL:-https://github.com/ekajaya740/dotfiles.git}"

# ── utilities ────────────────────────────────────────────────
info()  { printf "\033[1;34m[INFO]\033[0m  %s\n" "$*"; }
ok()    { printf "\033[1;32m[ OK ]\033[0m  %s\n" "$*"; }
warn()  { printf "\033[1;33m[WARN]\033[0m  %s\n" "$*"; }
err()   { printf "\033[1;31m[ERR]\033[0m  %s\n" "$*" >&2; }

has_cmd() { command -v "$1" &>/dev/null; }

# ── platform detection ──────────────────────────────────────
detect_platform() {
    case "$(uname -s)" in
        Darwin)  echo "macos"   ;;
        Linux)
            if [[ -f /etc/os-release ]]; then
                . /etc/os-release
                case "$ID" in
                    arch|archlinux|manjaro|omarchy) echo "arch"  ;;
                    debian|ubuntu|pop|linuxmint)    echo "debian" ;;
                    *)                              echo "linux"  ;;
                esac
            else
                echo "linux"
            fi
            ;;
        *)       echo "unsupported" ;;
    esac
}
PLATFORM=$(detect_platform)

# ── root check helper (we don't need root for most things) ──
require_sudo() {
    if [[ $EUID -eq 0 ]]; then
        return 0  # already root
    fi
    if has_cmd sudo; then
        sudo -n true 2>/dev/null && return 0
    fi
    return 1
}

# ── clone or update repo ────────────────────────────────────
ensure_repo() {
    if [[ -d "$DOTFILES_REPO/.git" ]]; then
        info "dotfiles repo exists — pulling latest"
        git -C "$DOTFILES_REPO" pull --ff-only
    else
        info "cloning dotfiles repo"
        if [[ -d "$DOTFILES_REPO" ]]; then
            # non-git dir exists; back it up
            mv "$DOTFILES_REPO" "${DOTFILES_REPO}.bak.$(date +%s)"
        fi
        git clone "$DOTFILES_URL" "$DOTFILES_REPO"
    fi
    cd "$DOTFILES_REPO"
}

# ── package installation ────────────────────────────────────
install_packages() {
    local missing=()
    for pkg in "$@"; do
        has_cmd "$pkg" || missing+=("$pkg")
    done
    if [[ ${#missing[@]} -eq 0 ]]; then
        ok "all required packages already installed"
        return
    fi

    info "installing: ${missing[*]}"

    case $PLATFORM in
        macos)
            if ! has_cmd brew; then
                info "installing Homebrew"
                /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
                # ensure brew is on PATH for x86_64 and ARM
                if [[ -x /opt/homebrew/bin/brew ]]; then
                    eval "$(/opt/homebrew/bin/brew shellenv)"
                elif [[ -x /usr/local/bin/brew ]]; then
                    eval "$(/usr/local/bin/brew shellenv)"
                fi
            fi
            brew install "${missing[@]}"
            ;;

        arch)
            if ! require_sudo; then
                err "sudo required for package installation on Arch"
                exit 1
            fi
            # prefer paru if available
            if has_cmd paru; then
                paru -S --noconfirm --needed "${missing[@]}"
            elif has_cmd yay; then
                yay -S --noconfirm --needed "${missing[@]}"
            else
                sudo pacman -S --noconfirm --needed "${missing[@]}"
            fi
            ;;

        debian)
            if ! require_sudo; then
                err "sudo required for package installation on Debian/Ubuntu"
                exit 1
            fi
            sudo apt-get update -qq
            sudo apt-get install -y -qq "${missing[@]}"
            ;;
    esac
}

# ── stow packages ────────────────────────────────────────────
STOW_PACKAGES=(nvim tmux zsh vim opencode claude omp pi agent codex)

stow_packages() {
    info "stowing packages: ${STOW_PACKAGES[*]}"

    # un-stow everything first to avoid conflicts
    for pkg in "${STOW_PACKAGES[@]}"; do
        if [[ -d "$DOTFILES_REPO/$pkg" ]]; then
            stow -D "$pkg" 2>/dev/null || true
        fi
    done

    # stow each package
    for pkg in "${STOW_PACKAGES[@]}"; do
        if [[ -d "$DOTFILES_REPO/$pkg" ]]; then
            stow "$pkg"
            ok "stowed $pkg"
        else
            warn "skipping $pkg — directory not found"
        fi
    done
}

# ── per-platform extras ─────────────────────────────────────
setup_macos_extras() {
    info "macOS extras"
    # iterm2 shell integration
    if ! has_cmd iterm2; then
        info "to install iTerm2: brew install --cask iterm2"
    fi
}

setup_arch_extras() {
    info "Arch extras"
    # nothing arch-specific beyond base packages for now
}

setup_debian_extras() {
    info "Debian extras"
    # ripgrep is rg, fd-find is fdfind on Debian
    if ! has_cmd rg && has_cmd apt-get; then
        install_packages ripgrep 2>/dev/null || true
    fi
    if ! has_cmd fdfind && has_cmd apt-get; then
        install_packages fd-find 2>/dev/null || true
    fi
    # symlink fdfind → fd for consistency with other platforms
    if has_cmd fdfind && ! has_cmd fd; then
        sudo ln -sf "$(command -v fdfind)" /usr/local/bin/fd 2>/dev/null || true
    fi
}

# ── oh-my-zsh ───────────────────────────────────────────────
setup_ohmyzsh() {
    if [[ -d "$HOME/.oh-my-zsh" ]]; then
        info "Oh My Zsh already installed"
    else
        info "installing Oh My Zsh"
        sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended
    fi

    # custom plugins
    local ZSH_CUSTOM="${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}"

    if [[ ! -d "$ZSH_CUSTOM/plugins/zsh-autosuggestions" ]]; then
        info "installing zsh-autosuggestions"
        git clone https://github.com/zsh-users/zsh-autosuggestions "$ZSH_CUSTOM/plugins/zsh-autosuggestions"
    fi

    if [[ ! -d "$ZSH_CUSTOM/plugins/zsh-syntax-highlighting" ]]; then
        info "installing zsh-syntax-highlighting"
        git clone https://github.com/zsh-users/zsh-syntax-highlighting "$ZSH_CUSTOM/plugins/zsh-syntax-highlighting"
    fi
}

# ── powerlevel10k ───────────────────────────────────────────
setup_powerlevel10k() {
    case $PLATFORM in
        macos)
            install_packages powerlevel10k
            ;;
        arch)
            install_packages zsh-theme-powerlevel10k
            ;;
        debian)
            # git clone into oh-my-zsh custom
            local ZSH_CUSTOM="${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}"
            if [[ ! -d "$ZSH_CUSTOM/themes/powerlevel10k" ]]; then
                info "installing powerlevel10k from git"
                git clone --depth=1 https://github.com/romkatv/powerlevel10k.git "$ZSH_CUSTOM/themes/powerlevel10k"
            fi
            ;;
    esac
}

# ── fzf ─────────────────────────────────────────────────────
setup_fzf() {
    if has_cmd fzf; then
        # install keybindings and completion
        if [[ ! -f "$HOME/.fzf.zsh" ]]; then
            "$(command -v fzf)" --zsh 2>/dev/null | head -1 > "$HOME/.fzf.zsh" 2>/dev/null || true
        fi
    fi
}

# ── mise (runtime version manager) ──────────────────────────
setup_mise() {
    if ! has_cmd mise; then
        info "installing mise"
        curl -fsSL https://mise.run | MISE_QUIET=1 sh
    else
        ok "mise already installed"
    fi

    # Source mise for this script session so `mise use` works
    local mise_bin
    mise_bin="$(command -v mise 2>/dev/null || echo "$HOME/.local/bin/mise")"
    if [[ -x "$mise_bin" ]]; then
        eval "$("$mise_bin" activate bash --shims)"
    fi

    # Install dev tools via mise
    info "installing node, yarn, make, neovim, vim, opencode, pi via mise"
    mise use -g \
        node@lts \
        yarn@latest \
        make@latest \
        neovim@stable \
        vim@latest \
        opencode@latest \
        pi@latest

    ok "mise tools installed"

    # omp (oh-my-pi) is not in the mise registry — install via bun
    if ! has_cmd omp; then
        info "installing oh-my-pi (omp) via bun"
        if has_cmd bun; then
            bun install -g @oh-my-pi/pi-coding-agent
        else
            curl -fsSL https://raw.githubusercontent.com/can1357/oh-my-pi/main/scripts/install.sh | sh
        fi
    else
        ok "omp already installed"
    fi
}

# ── neovim post-install ──────────────────────────────────────
setup_neovim() {
    # lazy.nvim auto-installs plugins on first launch
    info "neovim config ready — plugins will auto-install on first :Lazy sync or launch"
}


# ── machine-specific agent config ──────────────────────────
setup_machine_specific() {
    info "Applying machine-specific agent config..."

    # OMP: pi-notify-pp extension
    if has_cmd omp; then
        local ext_path="${DOTFILES_REPO}/pi/.pi/agent/extensions/pi-notify-pp/index.ts"
        if [[ -f "$ext_path" ]]; then
            omp config set extensions "[\"$ext_path\"]" 2>/dev/null || \
                warn "omp config set extensions failed — set manually: omp config set extensions '[\"$ext_path\"]'"
        fi
    fi

    # Gemini: RTK hook
    if has_cmd rtk; then
        rtk init -g --gemini --auto-patch 2>/dev/null || \
            warn "rtk gemini init failed — run: rtk init -g --gemini --auto-patch"
    fi

    # Codex: project trust (user must run manually)
    if has_cmd codex; then
        warn "Codex project trust is machine-specific. Add projects to ~/.codex/config.toml:"
        warn "  [projects.\"${HOME}/dotfiles\"]"
        warn "  trust_level = \"trusted\""
    fi

    ok "Machine-specific config applied"

}

# ── post-stow checks ────────────────────────────────────────
post_install_checks() {
    info "running post-install checks"

    # Backup any existing files that would conflict
    # (stow will refuse if files already exist)

    # Ensure .zshenv.local exists (sourced by .zshenv)
    if [[ ! -f "$HOME/.zshenv.local" ]]; then
        info "creating empty ~/.zshenv.local"
        touch "$HOME/.zshenv.local"
    fi

    # Validate JSON configs
    if has_cmd jq && [[ -f "$DOTFILES_REPO/opencode/.config/opencode/oh-my-openagent.json" ]]; then
        jq empty "$DOTFILES_REPO/opencode/.config/opencode/oh-my-openagent.json" && \
            ok "oh-my-openagent.json valid"
    fi

    # Validate YAML
    if has_cmd python3; then
        python3 -c "
import yaml, sys
for f in ['omp/.omp/agent/config.yml', 'omp/.omp/agent/models.yml']:
    try:
        yaml.safe_load(open(f))
        print(f'OK: {f}')
    except Exception as e:
        print(f'FAIL: {f} — {e}')
        sys.exit(1)
" 2>/dev/null && ok "OMP YAML configs valid" || warn "YAML validation skipped (missing pyyaml?)"
    fi
}

# ── main ────────────────────────────────────────────────────
main() {
    info "dotfiles bootstrap — platform: $PLATFORM"

    if [[ "$PLATFORM" == "unsupported" ]]; then
        err "unsupported platform: $(uname -s)"
        exit 1
    fi

    # 1. Clone / pull repo
    ensure_repo

    # 2. Install GNU Stow (prerequisite for everything else)
    install_packages stow

    # 3. Install platform tool dependencies (neovim, vim managed by mise)
    case $PLATFORM in
        macos)
            install_packages \
                tmux zsh \
                ripgrep fd shellcheck jq \
                fzf lazygit
            # Bun (OpenCode dependency)
            if ! has_cmd bun; then
                info "installing Bun"
                curl -fsSL https://bun.sh/install | bash
            fi
            setup_macos_extras
            ;;
        arch)
            install_packages \
                tmux zsh \
                ripgrep fd shellcheck jq \
                fzf lazygit
            # Bun from AUR
            if ! has_cmd bun; then
                install_packages bun-bin 2>/dev/null || warn "bun-bin not found in AUR; install manually"
            fi
            setup_arch_extras
            ;;
        debian)
            install_packages \
                tmux zsh \
                ripgrep fd-find shellcheck jq \

                fzf lazygit
            if ! has_cmd bun; then
                info "installing Bun"
                curl -fsSL https://bun.sh/install | bash
            fi
            setup_debian_extras
            ;;
    esac

    # Lightpanda headless browser (MCP server for browser automation)
    if ! has_cmd lightpanda; then
        info "installing Lightpanda"
        curl -fsSL https://pkg.lightpanda.io/install.sh | bash
    fi

    # 4. mise (node, yarn, make, neovim, vim, opencode, pi)
    setup_mise

    # 5. Oh My Zsh
    setup_ohmyzsh

    # 6. Powerlevel10k
    setup_powerlevel10k

    # 7. fzf keybindings
    setup_fzf

    # 8. Stow everything
    stow_packages

    # 9. Machine-specific agent config (extensions, hooks, trust)
    setup_machine_specific

    setup_neovim

    # 10. Validation
    post_install_checks

    # 11. Summary
    cat <<-'EOF'

    ─────────────────────────────────────────────
    ✓ Dotfiles bootstrap complete!

    Next steps:
      • Restart your shell or exec zsh:
          exec zsh

      • Launch Neovim to auto-install plugins:
          nvim +Lazy sync

      • Optional: set up Zsh as your default shell:
          chsh -s "$(which zsh)"

      • Install platform-specific agents:
          macOS:  brew install omp opencode claude-codex
          Arch:   yay -S omp-bin opencode-cli-bin claude-code-cli
          Debian: install from respective package managers

      • For OMP/OpenCode, the config assumes ollama-cloud models.
        Make sure OLLAMA_API_KEY is set in your environment:
          export OLLAMA_API_KEY="your-key"

      • For pi-notify-pp, bun is required to run index.ts.

    See ~/dotfiles/AGENTS.md for more details.
    ─────────────────────────────────────────────
EOF
}

main "$@"