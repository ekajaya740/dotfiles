return {
	{
		"neovim/nvim-lspconfig",
		event = { "BufReadPre", "BufNewFile" },
		dependencies = {
			"mason-org/mason.nvim",
			"mason-org/mason-lspconfig.nvim",
			"saghen/blink.cmp",
			{ "j-hui/fidget.nvim", opts = {} },
			{ "folke/neodev.nvim", opts = {} },
			"b0o/schemastore.nvim",
		},
		opts = {
			servers = {
				vtsls = {
					settings = {
						typescript = {
							inlayHints = {
								parameterNames = { enabled = "all" },
								functionLikeReturnTypes = { enabled = true },
								variableTypes = { enabled = true },
							},
						},
						javascript = {
							inlayHints = {
								parameterNames = { enabled = "all" },
								functionLikeReturnTypes = { enabled = true },
								variableTypes = { enabled = true },
							},
						},
					},
				},
				tailwindcss = {
					settings = {
						tailwindCSS = {
							classAttributes = { "class", "className", "class:list", "classList", "ngClass" },
							includeLanguages = {
								templ = "html",
								astro = "html",
								svelte = "html",
								vue = "html",
								jsx = "html",
								tsx = "html",
								solid = "html",
							},
						},
					},
				},
				volar = { filetypes = { "vue" } },
				svelte = {},
				astro = {},
				solidity = {},
				pyright = {
					settings = {
						python = {
							analysis = {
								typeCheckingMode = "basic",
								autoImportCompletions = true,
							},
						},
					},
				},
				gopls = {
					settings = {
						gopls = {
							analyses = {
								unusedparams = true,
								shadow = true,
							},
							staticcheck = true,
							gofumpt = true,
						},
					},
				},
				rust_analyzer = {
					settings = {
						["rust-analyzer"] = {
							cargo = { allFeatures = true },
							checkOnSave = { command = "clippy" },
							procMacro = { enable = true },
						},
					},
				},
				clangd = {
					settings = {
						clangd = {
							fallbackFlags = { "-std=c++20" },
						},
					},
				},
				omnisharp = {
					settings = {
						FormattingOptions = {
							EnableEditorConfigSupport = true,
							OrganizeImports = true,
						},
					},
				},
				intelephense = {
					settings = {
						intelephense = {
							environment = { phpVersion = "8.2" },
							files = { associations = { "*.php", "*.blade.php" } },
							diagnostics = { enable = true, builtins = true },
							indexes = { builtins = true, workspaces = true },
						},
					},
				},
				ruby_lsp = { settings = {} },
				dartls = {
					settings = {
						dart = {
							completeFunctionCalls = true,
							showTodos = true,
						},
					},
				},
				zls = {},
				lua_ls = {
					settings = {
						Lua = {
							workspace = { checkThirdParty = false },
							telemetry = { enable = false },
						},
					},
				},
				bashls = {},
				jsonls = {
					before_init = function(_, new_config)
						new_config.settings.json.schemas = new_config.settings.json.schemas or {}
						vim.list_extend(new_config.settings.json.schemas, require("schemastore").json.schemas())
					end,
					settings = {
						json = {
							format = { enable = true },
							validate = { enable = true },
						},
					},
				},
				yamlls = {
					before_init = function(_, new_config)
						new_config.settings.yaml.schemas = vim.tbl_deep_extend(
							"force",
							new_config.settings.yaml.schemas or {},
							require("schemastore").yaml.schemas()
						)
					end,
					settings = {
						redhat = { telemetry = { enabled = false } },
						yaml = {
							keyOrdering = false,
							format = { enable = true },
							validate = true,
							schemaStore = {
								enable = false,
								url = "",
							},
						},
					},
				},
				html = {},
				cssls = {},
				dockerls = {},
				docker_compose_language_service = {},
				prismals = {},
			},
		},
		config = function(_, opts)
			local lspconfig = require("lspconfig")
			local capabilities = vim.lsp.protocol.make_client_capabilities()
			capabilities = vim.tbl_deep_extend("force", capabilities, require("blink.cmp").get_lsp_capabilities())

			for server, server_opts in pairs(opts.servers) do
				if server ~= "jdtls" then
					server_opts.capabilities = capabilities
					lspconfig[server].setup(server_opts)
				end
			end

			require("config.plugins.jdtls").setup()

			vim.api.nvim_create_autocmd("BufWritePre", {
				group = vim.api.nvim_create_augroup("LspFormatting", {}),
				callback = function()
					vim.lsp.buf.format({ timeout_ms = 2000 })
				end,
			})
		end,
	},
}