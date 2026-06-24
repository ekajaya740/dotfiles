local MiniMap = require("mini.map")

MiniMap.setup({
	window = {
		side = "right",
		width = 10,
		winblend = 15,
	},
	integrations = {
		MiniMap.gen_integration.builtin_search(),
		MiniMap.gen_integration.diff(),
		MiniMap.gen_integration.diagnostic({
			error = "DiagnosticFloatingError",
			warn = "DiagnosticFloatingWarn",
			info = "DiagnosticFloatingInfo",
			hint = "DiagnosticFloatingHint",
		}),
	},
})
