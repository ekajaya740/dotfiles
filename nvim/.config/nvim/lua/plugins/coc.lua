return {
	{
		"neoclide/coc.nvim",
		branch = "release",
		config = function()
			require("config.plugins.coc")
		end,
	},
	{ "hrsh7th/nvim-cmp", enabled = false },
	{ "L3MON4D3/LuaSnip", enabled = false },
	{ "saadparwaiz1/cmp_luasnip", enabled = false },
	{ "rafamadriz/friendly-snippets", enabled = false },
	{ "neovim/nvim-lspconfig", enabled = false },
	{ "mason-org/mason.nvim", enabled = false },
	{ "mason-org/mason-lspconfig.nvim", enabled = false },
	{ "jay-babu/mason-null-ls.nvim", enabled = false },
	{ "nvimtools/none-ls.nvim", enabled = false },
}
