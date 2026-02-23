# ~/.zprofile - Login shell configuration
# Sourced once for login shells

# Start X on login (Linux only, if not already running)
if [[ -z "$DISPLAY" && "$XDG_VTNR" -eq 1 && "$(uname)" == "Linux" ]]; then
    exec startx
fi

# Start ssh-agent if not running
if command -v ssh-agent >/dev/null 2>&1; then
    if ! pgrep -u "$USER" ssh-agent >/dev/null 2>&1; then
        ssh-agent > "$XDG_RUNTIME_DIR/ssh-agent.env"
    fi
    if [[ -f "$XDG_RUNTIME_DIR/ssh-agent.env" ]]; then
        source "$XDG_RUNTIME_DIR/ssh-agent.env" >/dev/null
    fi
fi
