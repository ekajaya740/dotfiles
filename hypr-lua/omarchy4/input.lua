-- Personal input overrides. Loaded by ~/.config/hypr/hyprland.lua via
-- require("hypr.input"), after Omarchy's defaults.
--
-- Only the deltas from Omarchy 4's defaults are set here. Anything not listed
-- is left to Omarchy, so package updates keep improving the rest.
--
-- Omarchy 4 already defaults to:
--   repeat_rate = 40, repeat_delay = 250, numlock_by_default = true,
--   touchpad.scroll_factor = 0.4, touchpad.clickfinger_behavior = true
--   + terminal scroll_touchpad rules (Alacritty|kitty|foot = 1.5, ghostty = 0.2)

hl.config({
  input = {
    -- Keyboard layout.
    --
    -- NOTE: the old .conf used `grp:alta_shift_toggle`, which is NOT a valid
    -- xkb option -- it appears nowhere in /usr/share/X11/xkb. It had therefore
    -- been silently doing nothing. Replaced with a real option that keeps the
    -- same intent (both Alts switch layout), which is also what Omarchy 4
    -- itself suggests for multi-layout setups.
    kb_layout = "us",
    kb_options = "grp:alts_toggle",

    -- Omarchy 4 default is 250; you had 600.
    repeat_delay = 600,

    touchpad = {
      -- Omarchy 4 default is false; you had true.
      natural_scroll = true,
    },
  },
})
