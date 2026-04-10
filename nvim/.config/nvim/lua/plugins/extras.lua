return {
	{ "catppuccin/nvim", name = "catppuccin" },
	{ "nvim-neo-tree/neo-tree.nvim", enabled = false },
	{ "christoomey/vim-tmux-navigator" },
	{ "szw/vim-maximizer" },
	{ "tpope/vim-surround" },
	{ "inkarkat/vim-ReplaceWithRegister" },
	{ "mg979/vim-visual-multi", branch = "master" },
	{ "wakatime/vim-wakatime" },
	{ "f-person/git-blame.nvim", config = function() require("config.plugins.git-blame") end },
	{ "nvim-tree/nvim-tree.lua", config = function() require("config.plugins.nvim-tree") end },
	{ "nvim-tree/nvim-web-devicons" },
	{ "nvim-lualine/lualine.nvim", config = function() require("config.plugins.lualine") end },
	{ "nvim-telescope/telescope.nvim", branch = "0.1.x", config = function() require("config.plugins.telescope") end },
	{ "nvim-telescope/telescope-fzf-native.nvim", build = "make" },
	{ "kiyoon/telescope-insert-path.nvim" },
	{ "dimaportenko/telescope-simulators.nvim", config = function() require("config.plugins.telescope-simulators") end },
	{ "nvim-telescope/telescope-media-files.nvim" },
	{ "numToStr/Comment.nvim", config = function() require("config.plugins.comment") end },
	{ "JoosepAlviste/nvim-ts-context-commentstring" },
	{ "windwp/nvim-autopairs", config = function() require("config.plugins.autopairs") end },
	{ "windwp/nvim-ts-autotag", dependencies = { "nvim-treesitter/nvim-treesitter" } },
	{ "nvim-treesitter/nvim-treesitter", build = ":TSUpdate", config = function() require("config.plugins.treesitter") end },
	{
		"laytan/tailwind-sorter.nvim",
		dependencies = { "nvim-treesitter/nvim-treesitter", "nvim-lua/plenary.nvim" },
		build = "cd formatter && npm i && npm run build",
		config = function()
			require("config.plugins.tailwind-sorter")
		end,
	},
	{ "lewis6991/gitsigns.nvim", config = function() require("config.plugins.gitsigns") end },
	{
		"folke/todo-comments.nvim",
		dependencies = { "nvim-lua/plenary.nvim" },
		config = function()
			require("config.plugins.todo")
		end,
	},
	{
		"lukas-reineke/indent-blankline.nvim",
		dependencies = { "TheGLander/indent-rainbowline.nvim" },
		config = function()
			require("config.plugins.indent-blankline")
		end,
	},
	{ "liuchengxu/graphviz.vim" },
	{
		"iamcco/markdown-preview.nvim",
		build = function()
			vim.fn["mkdp#util#install"]()
		end,
	},
	{
		"aurum77/live-server.nvim",
		build = function()
			require("live_server.util").install()
		end,
		cmd = { "LiveServer", "LiveServerStart", "LiveServerStop" },
	},
	{
		"rest-nvim/rest.nvim",
		dependencies = {
			"nvim-treesitter/nvim-treesitter",
		},
	},
	{
		"erichlf/devcontainer-cli.nvim",
		dependencies = { "akinsho/toggleterm.nvim" },
		config = function()
			require("config.plugins.devcontainer-cli")
		end,
	},
}
