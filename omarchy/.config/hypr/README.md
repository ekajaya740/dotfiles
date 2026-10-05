# Omarchy Hyprland Configs

Managed via stow (`omarchy` package → `~/.config/hypr/`). Source of truth is this
directory; edit here, symlink delivers live.

## Files

| File | Custom? | Notes |
|---|---|---|
| `bindings.conf` | **YES** | All app/webapp binds below + Tmux bind on `SUPER ALT+RETURN` |
| `input.conf` | **YES** | see below |
| `hyprlock.conf` | **YES** | `font_family = CaskaydiaMono Nerd Font` (default: JetBrainsMono) |
| `xdph.conf` | **YES** | same lines, different order vs default (cosmetic) |
| `hyprland.conf` | minor | adds `source = ~/.config/hypr/envs.conf` line |
| `envs.conf` | minor | file exists, all content commented out |
| `autostart.conf` | **YES** | `exec-once = fcitx5 -d --replace` (fcitx5 IME for CJK) |
| `hypridle.conf` | no | matches Omarchy default |
| `hyprsunset.conf` | no | matches Omarchy default |
| `looknfeel.conf` | no | all commented (stock template) |
| `monitors.conf` | no | stock template (older comment wording) |

## Key customizations to re-apply after any refresh/reset

1. **fcitx5 autostart** (`autostart.conf`): `exec-once = fcitx5 -d --replace`
2. **Keyboard**: `kb_options = grp:alta_shift_toggle`, `repeat_rate = 40`, `repeat_delay = 600`, `numlock_by_default = true`
3. **Touchpad**: `natural_scroll = true`, `scroll_factor = 0.4`
4. **Terminal scroll rules**: `windowrule = match:class (Alacritty|kitty|foot), scroll_touchpad 1.5` and `match:class com.mitchellh.ghostty, scroll_touchpad 0.2`
5. **hyprlock font**: CaskaydiaMono Nerd Font
6. **Tmux bind**: `SUPER ALT+RETURN` → tmux with cwd tracking
7. **envs.conf sourced** from hyprland.conf

## Full app/webapp bindings (bindings.conf)

SUPER+RETURN (terminal), SUPER SHIFT+RETURN (browser), SUPER ALT+RETURN (tmux),
SUPER SHIFT+F / ALT+SHIFT+F (nautilus + cwd), SUPER SHIFT+B/ALT+B (browser/private),
SUPER SHIFT+M/ALT+M (spotify / cliamp TUI), SUPER SHIFT+N (editor), T (btop),
D (lazydocker), G (Signal), O (Obsidian), W (Typora w/ wayland-ime), SLASH (1Password),
SUPER SHIFT+A/ALT+A (ChatGPT/Grok), C (hey calendar), E (hey email), Y (YouTube),
ALT+G (WhatsApp), CTRL+G (Google Messages), P (Google Photos), X/ALT+X (X / compose),
ALT+SPACE (fcitx5 IME toggle).

## Future: Omarchy 4 (quattro) migration

Omarchy 3.8.5 is fully hyprlang-based; Hyprland ≥0.55 prefers Lua configs
(`hyprland.lua`). Legacy .conf still loads fine on Hyprland 0.56.2 (log line
`using legacy config` is DEBUG-level, not an error). Upstream drops hyprlang
after "1–2 releases from 0.55" — migrate before Hyprland ≥0.57 hits repos.

Supported path: `omarchy-upgrade-to-quattro` (ships with Omarchy 3.8.5). It:
- converts the distro to package-backed Omarchy 4 (Lua config tree)
- installs default `hyprland.lua`, `bindings.lua`, `input.lua`, `looknfeel.lua`,
  `monitors.lua`, `autostart.lua` into `~/.config/hypr/`
- keeps legacy user `.conf` files in place but **does NOT translate them** —
  after reboot Lua is active and those files are inert
- moves theme state to `~/.local/state/omarchy/current`

**The Lua port is live and versioned** — the five overrides are kept in
`hypr-lua/omarchy4/` in this repo and installed (real files, not symlinks) as
`~/.config/hypr/{autostart,bindings,input,looknfeel,monitors}.lua`, loaded by
Omarchy 4's stock `hyprland.lua` via `require("hypr.*")` after its defaults.

Verified with `Hyprland --verify-config -c ~/.config/hypr/hyprland.lua`
→ `config ok` on 0.56.2.

What the port contains:
- `autostart.lua`: fcitx5 line
- `input.lua`: kb_options, repeat rate/delay, numlock, touchpad, scroll rules
- `bindings.lua`: all 27 app/webapp binds; `bindd = MODS, KEY, Desc, exec, cmd`
  maps to `hl.bind("MODS + KEY", hl.dsp.exec_cmd("cmd"), { description = "Desc" })`
  — note the description moves from positional into the flags table
- `monitors.lua`: `GDK_SCALE=2` + monitor line (it was in monitors.conf upstream)
- `looknfeel.lua` / `envs.lua`: ported as commented stubs, matching upstream

`hyprlock.conf`, `hypridle.conf`, `hyprsunset.conf` and `xdph.conf` stay hyprlang
— they are read by separate binaries that still use it. Do not convert those.

Two findings worth keeping:
- **0 bind collisions.** All 27 binds were checked against every Omarchy default
  fragment actually sourced. `plain-bindings.conf` is *not* sourced and would
  otherwise report 7 phantom collisions.
- quattro installs its own `hyprland.lua` and sources the Omarchy defaults. Do
  not overwrite it — drop the port in `~/.config/hypr/custom/` and `require()`
  the modules from the end of quattro's entrypoint.

Pre-upgrade snapshot: `~/dotfiles/omarchy-legacy-backup/hypr-conf-20260922/`
(real files; a plain `cp -a` of `~/.config/hypr` copies *symlinks*, not content).