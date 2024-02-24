local setup, tailwind_sorter = pcall(require, "tailwind-sorter")
if not setup then
	return
end

tailwind_sorter.setup()
