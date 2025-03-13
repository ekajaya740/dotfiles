return {
  "stevearc/conform.nvim",
  opts = {
    formatters_by_ft = {
      ruby = { "solargraph", "rubocop" },
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
    stop_after_first = true,
    format_on_save = false,
  },
}
