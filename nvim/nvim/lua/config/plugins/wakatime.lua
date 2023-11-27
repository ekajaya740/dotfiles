local setup, wakatime = pcall(require, "vim-wakatime")

if not setup then
	return
end

wakatime.setup()
