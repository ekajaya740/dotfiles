local setup, todo = pcall(require, "todo-comments")
if not setup then
	return
end

todo.setup()

local keymap = vim.keymap -- for conciseness

keymap.set("n", "<leader>ft", "<cmd>TodoTelescope<CR>", opts) -- show definition, references
