local M = {}

local setup_opts = {}

function M.setup(opts)
  setup_opts = opts or {}

  local ok, treesitter = pcall(require, "nvim-treesitter")
  if ok and type(treesitter.setup) == "function" then
    treesitter.setup(setup_opts)
  end
end

function M.get_module(name)
  local module = setup_opts[name]
  if type(module) == "table" then
    return module
  end

  return { additional_vim_regex_highlighting = false }
end

function M.is_enabled(name, lang, _bufnr)
  local module = setup_opts[name]
  if module == nil then
    return false
  end

  if type(module) ~= "table" then
    return module == true
  end

  if module.enable == false then
    return false
  end

  if type(module.enable) == "table" then
    return vim.tbl_contains(module.enable, lang)
  end

  if type(module.disable) == "table" and vim.tbl_contains(module.disable, lang) then
    return false
  end

  return module.enable == nil or module.enable == true
end

return M
