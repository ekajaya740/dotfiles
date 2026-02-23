-- import git blame plugin safely
local setup, gitblame = pcall(require, "gitblame")
if not setup then
	return
end

-- configure/enable git blame
gitblame.setup({
	enable = true,
})
