local M = {}

function M.setup()
	local lspconfig = require("lspconfig")

	local jdtls_path = vim.fn.stdpath("data") .. "/mason/packages/jdtls"
	local lombok_jar = vim.fn.expand("~/.local/share/nvim/lombok.jar")

	local cmd = { jdtls_path .. "/bin/jdtls" }

	if vim.fn.filereadable(lombok_jar) == 1 then
		table.insert(cmd, "--jvm-arg=-javaagent:" .. lombok_jar)
	end

	local project_name = vim.fn.fnamemodify(vim.fn.getcwd(), ":p:h:t")
	local workspace_dir = vim.fn.stdpath("data") .. "/jdtls-workspaces/" .. project_name

	vim.list_extend(cmd, {
		"-data",
		workspace_dir,
	})

	lspconfig.jdtls.setup({
		cmd = cmd,
		capabilities = vim.tbl_deep_extend(
			"force",
			vim.lsp.protocol.make_client_capabilities(),
			require("blink.cmp").get_lsp_capabilities()
		),
		settings = {
			java = {
				format = { enabled = true },
				signatureHelp = { enabled = true },
				implementationCodeLens = { enabled = true },
				codeGeneration = {
					toString = {
						template = "${class.name}(${field.name}=${field.value}, ${otherFields})",
					},
					hashCodeEquals = {
						useJava7Objects = true,
					},
					useBlocks = true,
				},
				sources = {
					organizeImports = {
						starThreshold = 5,
						staticStarThreshold = 3,
					},
				},
				completion = {
					favoriteStaticMembers = {
						"org.junit.jupiter.api.Assertions.*",
						"org.mockito.Mockito.*",
						"java.util.Collections.*",
					},
				},
				annotations = {
					enabled = true,
				},
			},
		},
		init_options = {
			extendedClientCapabilities = {
				progressReportProvider = false,
			},
		},
	})
end

return M