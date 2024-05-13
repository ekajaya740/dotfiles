local setup, doge = pcall(require, "doge")
if not setup then
	return
end

local g = vim.g

g.doge_enable_mappings = 0

doge.setup()
