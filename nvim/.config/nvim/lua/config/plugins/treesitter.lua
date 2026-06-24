-- Pre-register languages to avoid Telescope previewer race (nil tree)
pcall(vim.treesitter.language.add, "json")
pcall(vim.treesitter.language.add, "javascript")
pcall(vim.treesitter.language.add, "typescript")
pcall(vim.treesitter.language.add, "tsx")
pcall(vim.treesitter.language.add, "yaml")
pcall(vim.treesitter.language.add, "html")
pcall(vim.treesitter.language.add, "css")
pcall(vim.treesitter.language.add, "markdown")
pcall(vim.treesitter.language.add, "bash")
pcall(vim.treesitter.language.add, "lua")
pcall(vim.treesitter.language.add, "vim")
pcall(vim.treesitter.language.add, "python")
pcall(vim.treesitter.language.add, "go")
pcall(vim.treesitter.language.add, "rust")
pcall(vim.treesitter.language.add, "java")
pcall(vim.treesitter.language.add, "php")
pcall(vim.treesitter.language.add, "ruby")
pcall(vim.treesitter.language.add, "c")
pcall(vim.treesitter.language.add, "cpp")
pcall(vim.treesitter.language.add, "c_sharp")
pcall(vim.treesitter.language.add, "dockerfile")
pcall(vim.treesitter.language.add, "gitignore")
pcall(vim.treesitter.language.add, "vue")
pcall(vim.treesitter.language.add, "svelte")
pcall(vim.treesitter.language.add, "astro")
pcall(vim.treesitter.language.add, "dart")
pcall(vim.treesitter.language.add, "zig")
pcall(vim.treesitter.language.add, "prisma")
pcall(vim.treesitter.language.add, "graphql")
pcall(vim.treesitter.language.add, "scss")
pcall(vim.treesitter.language.add, "http")
pcall(vim.treesitter.language.add, "blade")
pcall(vim.treesitter.language.add, "phpdoc")
pcall(vim.treesitter.language.add, "markdown_inline")

-- import nvim-treesitter plugin safely
local status, treesitter = pcall(require, "nvim-treesitter.configs")
if not status then
	return
end

-- configure treesitter
treesitter.setup({
	-- enable syntax highlighting
	highlight = {
		enable = true,
		additional_vim_regex_highlighting = false,
	},
	-- enable indentation
	indent = { enable = true },
	-- enable autotagging (w/ nvim-ts-autotag plugin)
	autotag = { enable = true, enable_close_tag = false },
	-- ensure these language parsers are installed
	ensure_installed = {
		"json",
		"javascript",
		"typescript",
		"tsx",
		"yaml",
		"html",
		"css",
		"markdown",
		"markdown_inline",
		"bash",
		"lua",
		"vim",
		"dockerfile",
		"gitignore",
		"java",
		"dart",
		"http",
		"vue",
		"svelte",
		"astro",
		"php",
		"phpdoc",
		"blade",
		"python",
		"go",
		"rust",
		"c",
		"cpp",
		"c_sharp",
		"ruby",
		"zig",
		"prisma",
		"graphql",
		"scss",
	},
	-- auto install above language parsers
	auto_install = true,
	context_commentstring = {
		enable = false,

		config = {
			javascript = {
				__default = "// %s",
				jsx_element = "{/* %s */}",
				jsx_fragment = "{/* %s */}",
				jsx_attribute = "// %s",
				comment = "// %s",
			},
			typescript = { __default = "// %s", __multiline = "/* %s */" },
		},
	},
})
