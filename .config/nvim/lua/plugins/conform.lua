return {
  "stevearc/conform.nvim",
  opts = {
    formatters_by_ft = {
      ruby = {
        "rubocop",
      },
      eruby = { "erb_format" },
      markdown = { "markdownlint" },
      yaml = { "yamlfix" },
      javascript = { "prettierd", "prettier" },
      typescript = { "prettierd", "prettier" },
      json = { "jq" },
    },
  },
}
