return {
  "stevearc/conform.nvim",
  opts = {
    formatters_by_ft = {
      ruby = { "rubyfmt" },
      eruby = { "erb_format" },
      markdown = { "markdownlint" },
      yaml = { "yamlfmt" },
      javascript = { "prettierd", "prettier" },
      typescript = { "prettierd", "prettier" },
      json = { "jq" },
    },
    formatters = {},
  },
}
