-- import telescope plugin safely
local fallback_ts_configs = {
  setup = function() end,
  get_module = function()
    return { additional_vim_regex_highlighting = false }
  end,
  is_enabled = function()
    return false
  end,
}

local ts_configs_ok, ts_configs = pcall(require, "nvim-treesitter.configs")
if not ts_configs_ok or type(ts_configs) ~= "table" then
  package.preload["nvim-treesitter.configs"] = function()
    return fallback_ts_configs
  end
  ts_configs = fallback_ts_configs
end

if type(ts_configs.setup) ~= "function" then
  ts_configs.setup = fallback_ts_configs.setup
end

if type(ts_configs.get_module) ~= "function" then
  ts_configs.get_module = fallback_ts_configs.get_module
end

if type(ts_configs.is_enabled) ~= "function" then
  ts_configs.is_enabled = fallback_ts_configs.is_enabled
end

package.loaded["nvim-treesitter.configs"] = ts_configs

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
local ts_parsers_setup, ts_parsers = pcall(require, "nvim-treesitter.parsers")

if ts_parsers_setup then
  if type(ts_parsers.ft_to_lang) ~= "function" then
    ts_parsers.ft_to_lang = function(ft)
      local ok, lang = pcall(vim.treesitter.language.get_lang, ft)
      if ok and type(lang) == "string" and lang ~= "" then
        return lang
      end
      return ft
    end
  end

  if type(ts_parsers.get_parser) ~= "function" then
    ts_parsers.get_parser = function(bufnr, lang)
      return vim.treesitter.get_parser(bufnr, lang)
    end
  end
end

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
      find_command = {
        "rg",
        "--files",
        "--hidden",
        "--glob",
        "!**/.git/*",
      },
    },
    live_grep = {
      additional_args = function()
        return { "--hidden", "--glob", "!**/.git/*" }
      end,
    },
    grep_string = {
      additional_args = function()
        return { "--hidden", "--glob", "!**/.git/*" }
      end,
    },
  },
})

telescope.load_extension("fzf")
telescope.load_extension("media_files")
