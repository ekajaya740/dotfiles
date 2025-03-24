vim.api.nvim_create_user_command("FormatDisable", function(args)
  if args.bang then
    -- FormatDisable! will disable formatting just for this buffer
    vim.b.disable_autoformat = true
  else
    vim.g.disable_autoformat = true
  end
end, {
  desc = "Disable autoformat-on-save",
  bang = true,
})
vim.api.nvim_create_user_command("FormatEnable", function()
  vim.b.disable_autoformat = false
  vim.g.disable_autoformat = false
end, {
  desc = "Re-enable autoformat-on-save",
})

return {
  "stevearc/conform.nvim",
  opts = {
    formatters_by_ft = {
      ruby = { "solargraph" },
      -- eruby = {
      --   "erb_format",
      -- },
      markdown = { "markdownlint" },
      yaml = { "yamlfmt" },
      -- javascript = { "prettierd", "prettier" },
      typescript = { "prettierd", "prettier" },
      json = { "jq" },
      php = { { "pint", "php_cs_fixer", "php" } },
      blade = { "blade-formatter" },
    },
  },
  format_on_save = {
    lsp_format = "fallback",
    timeout_ms = 500,
  },
}
