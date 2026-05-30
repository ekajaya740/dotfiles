local ts_comment_ok, ts_comment = pcall(require, "ts_context_commentstring")
if ts_comment_ok then
	ts_comment.setup({ enable_autocmd = false })
end

local comment_integrations_ok, comment_integrations =
	pcall(require, "ts_context_commentstring.integrations.comment_nvim")

local setup, comment = pcall(require, "Comment")
if not setup then
	return
end

comment.setup({
	toggler = {
		line = "lc",
		block = "bc",
	},
	opleader = {
		line = "lc",
		block = "bc",
	},
	pre_hook = function(ctx)
		if comment_integrations_ok then
			local ok, result = pcall(comment_integrations.create_pre_hook(), ctx)
			if ok then
				return result
			end
		end
	end,
})