return {
	{
		"folke/snacks.nvim",
		keys = {
			{ "<leader><space>", false },
			{ "<leader>/", false },
			{ "<leader>e", false },
			{ "<leader>fe", false },
			{ "<leader>fE", false },
			{ "<leader>ff", false },
			{ "<leader>fc", false },
		},
		opts = function(_, opts)
			opts = opts or {}
			opts.picker = opts.picker or {}
			opts.picker.sources = opts.picker.sources or {}

			opts.picker.sources.files = vim.tbl_deep_extend("force", opts.picker.sources.files or {}, {
				hidden = true,
				ignored = false,
			})

			opts.picker.sources.grep = vim.tbl_deep_extend("force", opts.picker.sources.grep or {}, {
				hidden = true,
				ignored = false,
			})

			opts.picker.sources.grep_word = vim.tbl_deep_extend("force", opts.picker.sources.grep_word or {}, {
				hidden = true,
				ignored = false,
			})

			opts.picker.sources.explorer = vim.tbl_deep_extend("force", opts.picker.sources.explorer or {}, {
				hidden = true,
				ignored = false,
			})

			return opts
		end,
	},
}
