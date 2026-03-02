return {
	{
		"mason-org/mason.nvim",
		cmd = "Mason",
		build = ":MasonUpdate",
		opts = {
			ensure_installed = {
				-- Formatters & Linters (universal)
				"prettierd",
				"prettier",
				"eslint_d",
				"stylua",
				"shfmt",
				"shellcheck",

				-- JavaScript/TypeScript
				"typescript-language-server",
				"js-debug-adapter",
				"vtsls",

				-- JSON/YAML
				"json-lsp",
				"yaml-language-server",

				-- HTML/CSS
				"html-lsp",
				"css-lsp",
				"tailwindcss-language-server",

				-- Vue
				"vue-language-server",

				-- Svelte
				"svelte-language-server",

				-- Astro
				"astro-language-server",

				-- Solidity
				"solidity",

				-- Java
				"jdtls",

				-- Python
				"pyright",
				"ruff",
				"debugpy",

				-- Go
				"gopls",
				"goimports",
				"gofumpt",

				-- Rust
				"rust-analyzer",
				"codelldb",

				-- C/C++
				"clangd",
				"clang-format",

				-- C# / .NET
				"omnisharp",

				-- PHP (Laravel, WordPress, general)
				"intelephense",
				"phpcs",
				"php-cs-fixer",

				-- Ruby
				"ruby-lsp",
				"rubocop",

				-- Dart/Flutter (dartls is installed via Dart SDK, not Mason)
				-- "dart-debug-adapter",  -- Install separately if needed for debugging

				-- Zig
				"zls",

				-- Lua
				"lua-language-server",

				-- Shell
				"bash-language-server",

				-- Docker
				"dockerfile-language-server",
				"docker-compose-language-service",

				-- Prisma
				"prisma-language-server",

				-- GraphQL
				"graphql-language-service-cli",

				-- Markdown
				"marksman",
			},
		},
	},
	{
		"mason-org/mason-lspconfig.nvim",
		dependencies = { "mason-org/mason.nvim" },
		opts = {
			automatic_installation = true,
		},
	},
}