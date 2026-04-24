require("devcontainer").setup({
	generate_commands = true,
	autocommands = {
		init = false,
		clean = false,
		update = false,
	},
	log_level = "info",
	cache_images = true,
	attach_mounts = {
		neovim_config = {
			enabled = true,
			options = { "readonly" },
		},
		neovim_data = {
			enabled = false,
			options = {},
		},
		neovim_state = {
			enabled = false,
			options = {},
		},
	},
})
