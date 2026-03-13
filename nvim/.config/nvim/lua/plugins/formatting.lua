return {
	{
		"mfussenegger/nvim-lint",
		optional = true,
		opts = {
			linters_by_ft = {
				javascript = { "eslint_d" },
				javascriptreact = { "eslint_d" },
				typescript = { "eslint_d" },
				typescriptreact = { "eslint_d" },
				vue = { "eslint_d" },
				svelte = { "eslint_d" },
				sh = { "shellcheck" },
				ruby = { "rubocop" },
			},
		},
	},
	{
		"stevearc/conform.nvim",
		enabled = false,
	},
}
