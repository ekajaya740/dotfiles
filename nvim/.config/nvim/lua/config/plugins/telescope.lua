-- import telescope plugin safely
local telescope_setup, telescope = pcall(require, "telescope")
if not telescope_setup then
  return
end

-- import telescope actions safely
local actions_setup, actions = pcall(require, "telescope.actions")
if not actions_setup then
  return
end

local path_setup, path_actions = pcall(require, "telescope_insert_path")

local normal_mappings = {}
if path_setup then
  normal_mappings = {
    ["["] = path_actions.insert_reltobufpath_visual,
    ["]"] = path_actions.insert_abspath_visual,
    ["{"] = path_actions.insert_reltobufpath_insert,
    ["}"] = path_actions.insert_abspath_insert,
    ["-"] = path_actions.insert_reltobufpath_normal,
    ["="] = path_actions.insert_abspath_normal,
  }
end

-- configure telescope
telescope.setup({
  defaults = {
    no_ignore = true,
    no_ignore_parent = true,
    hidden = true,
    file_ignore_patterns = {},
    vimgrep_arguments = {
      "rg",
      "--color=never",
      "--no-heading",
      "--with-filename",
      "--line-number",
      "--column",
      "--smart-case",
      "--hidden",
      "--no-ignore",
      "--glob",
      "!**/.git/*",
    },
    mappings = {
      i = {
        ["<C-k>"] = actions.move_selection_previous,                       -- move to prev result
        ["<C-j>"] = actions.move_selection_next,                           -- move to next result
        ["<C-q>"] = actions.send_selected_to_qflist + actions.open_qflist, -- send selected to quickfixlist
      },
      n = normal_mappings,
    },
  },
  pickers = {
    find_files = {
      hidden = true,
      no_ignore = true,
      no_ignore_parent = true,
      find_command = {
        "rg",
        "--files",
        "--hidden",
        "--no-ignore",
        "--glob",
        "!**/.git/*",
      },
    },
    live_grep = {
      additional_args = function()
        return { "--hidden", "--no-ignore", "--glob", "!**/.git/*" }
      end,
    },
    grep_string = {
      additional_args = function()
        return { "--hidden", "--no-ignore", "--glob", "!**/.git/*" }
      end,
    },
  },
})

telescope.load_extension("fzf")
telescope.load_extension("media_files")
