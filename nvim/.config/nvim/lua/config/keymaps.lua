-- set leader key to space
vim.g.mapleader = " "

local keymap = vim.keymap -- for conciseness

---------------------
-- General Keymaps
---------------------

-- clear search highlights
keymap.set("n", "<leader>nh", ":nohl<CR>")

-- delete single character without copying into register
keymap.set("n", "x", '"_x')

-- increment/decrement numbers
keymap.set("n", "<leader>+", "<C-a>") -- increment
keymap.set("n", "<leader>-", "<C-x>") -- decrement

-- window management
keymap.set("n", "<leader>sv", "<C-w>v") -- split window vertically
keymap.set("n", "<leader>sh", "<C-w>s") -- split window horizontally
keymap.set("n", "<leader>se", "<C-w>=") -- make split windows equal width & height
keymap.set("n", "<leader>sx", ":close<CR>") -- close current split window

keymap.set("n", "<leader>to", ":tabnew<CR>") -- open new tab
keymap.set("n", "<leader>tx", ":tabclose<CR>") -- close current tab
keymap.set("n", "<leader>tn", ":tabn<CR>") --  go to next tab
keymap.set("n", "<leader>tp", ":tabp<CR>") --  go to previous tab

----------------------
-- Plugin Keybinds
----------------------

-- vim-maximizer
keymap.set("n", "<leader>sm", ":MaximizerToggle<CR>") -- toggle split window maximization

-- nvim-tree
local function set_file_picker_keymaps()
	for _, lhs in ipairs({ "<leader>e", "<leader>E", "<leader>fe", "<leader>fE", "<leader><space>", "<leader>/", "<leader>ff", "<leader>fs", "<leader>fc" }) do
		pcall(vim.keymap.del, "n", lhs)
	end

	keymap.set("n", "<leader>e", "<cmd>NvimTreeToggle<CR>")
	keymap.set("n", "<leader>fe", "<cmd>lua Snacks.explorer({ cwd = LazyVim.root(), hidden = true, ignored = false })<CR>")
	keymap.set("n", "<leader>fE", "<cmd>lua Snacks.explorer({ hidden = true, ignored = false })<CR>")
	keymap.set("n", "<leader>E", "<leader>fE", { remap = true })
	keymap.set("n", "<leader><space>", "<cmd>Telescope find_files hidden=true<cr>")
	keymap.set("n", "<leader>/", "<cmd>Telescope live_grep hidden=true<cr>")
	keymap.set("n", "<leader>ff", "<cmd>Telescope find_files hidden=true<cr>")
	keymap.set("n", "<leader>fs", "<cmd>Telescope live_grep hidden=true<cr>")
	keymap.set("n", "<leader>fc", "<cmd>Telescope grep_string hidden=true<cr>")
end

set_file_picker_keymaps()
vim.schedule(set_file_picker_keymaps)
vim.api.nvim_create_autocmd("User", {
	pattern = "VeryLazy",
	callback = set_file_picker_keymaps,
})
vim.api.nvim_create_autocmd("User", {
	pattern = "LazyVimStarted",
	callback = set_file_picker_keymaps,
})

-- telescope
keymap.set("n", "<leader>fb", "<cmd>Telescope buffers<cr>") -- list open buffers in current neovim instance
keymap.set("n", "<leader>fh", "<cmd>Telescope help_tags<cr>") -- list available help tags
keymap.set("n", "<leader>fm", "<cmd>Telescope media_files<cr>") -- list media files in current working directory

keymap.set("n", "<leader>rr", ":Rest run<cr>")
keymap.set("n", "<leader>rl", ":Rest last<cr>")
keymap.set("n", "<leader>ro", ":Rest open<cr>")

-- telescope git commands (not on youtube nvim video)
keymap.set("n", "<leader>gc", "<cmd>Telescope git_commits<cr>") -- list all git commits (use <cr> to checkout) ["gc" for git commits]
keymap.set("n", "<leader>gfc", "<cmd>Telescope git_bcommits<cr>") -- list git commits for current file/buffer (use <cr> to checkout) ["gfc" for git file commits]
keymap.set("n", "<leader>gb", "<cmd>Telescope git_branches<cr>") -- list git branches (use <cr> to checkout) ["gb" for git branch]
keymap.set("n", "<leader>gs", "<cmd>Telescope git_status<cr>") -- list current changes per file with diff preview ["gs" for git status]

----------------------
-- LSP Keybinds (set on attach)
----------------------

vim.api.nvim_create_autocmd("LspAttach", {
	group = vim.api.nvim_create_augroup("UserLspConfig", {}),
	callback = function(ev)
		local opts = { buffer = ev.buf, silent = true }
		keymap.set("n", "gd", vim.lsp.buf.definition, opts)
		keymap.set("n", "gy", vim.lsp.buf.type_definition, opts)
		keymap.set("n", "gi", vim.lsp.buf.implementation, opts)
		keymap.set("n", "gr", vim.lsp.buf.references, opts)
		keymap.set("n", "K", vim.lsp.buf.hover, opts)
		keymap.set("n", "<leader>rn", vim.lsp.buf.rename, opts)
		keymap.set("n", "<leader>ca", vim.lsp.buf.code_action, opts)
		keymap.set("n", "[g", vim.diagnostic.goto_prev, opts)
		keymap.set("n", "]g", vim.diagnostic.goto_next, opts)
		keymap.set("n", "<leader>fm", function()
			vim.lsp.buf.format({ async = true })
		end, opts)
	end,
})

vim.api.nvim_create_autocmd("FileType", {
	pattern = "java",
	group = vim.api.nvim_create_augroup("JavaKeymaps", {}),
	callback = function(ev)
		local opts = { buffer = ev.buf, silent = true }
		keymap.set("n", "<leader>co", "<cmd>JavaBuildBuildWorkspace<cr>", vim.tbl_extend("force", opts, { desc = "Organize Imports" }))
		keymap.set("n", "<leader>cj", vim.lsp.buf.code_action, vim.tbl_extend("force", opts, { desc = "Java Code Action" }))
		keymap.set("n", "<leader>cem", "<cmd>JavaRefactorExtractMethod<cr>", vim.tbl_extend("force", opts, { desc = "Extract Method" }))
		keymap.set("n", "<leader>cev", "<cmd>JavaRefactorExtractVariable<cr>", vim.tbl_extend("force", opts, { desc = "Extract Variable" }))
		keymap.set("n", "<leader>ceV", "<cmd>JavaRefactorExtractVariableAllOccurrence<cr>", vim.tbl_extend("force", opts, { desc = "Extract Variable All" }))
		keymap.set("n", "<leader>cec", "<cmd>JavaRefactorExtractConstant<cr>", vim.tbl_extend("force", opts, { desc = "Extract Constant" }))
		keymap.set("n", "<leader>cef", "<cmd>JavaRefactorExtractField<cr>", vim.tbl_extend("force", opts, { desc = "Extract Field" }))
		keymap.set("n", "<leader>dr", "<cmd>JavaRunnerRunMain<cr>", vim.tbl_extend("force", opts, { desc = "Run Main" }))
		keymap.set("n", "<leader>ds", "<cmd>JavaRunnerStopMain<cr>", vim.tbl_extend("force", opts, { desc = "Stop Main" }))
		keymap.set("n", "<leader>dt", "<cmd>JavaTestRunCurrentClass<cr>", vim.tbl_extend("force", opts, { desc = "Test Current Class" }))
		keymap.set("n", "<leader>dT", "<cmd>JavaTestDebugCurrentClass<cr>", vim.tbl_extend("force", opts, { desc = "Debug Current Class" }))
	end,
})
