local ok, ibl = pcall(require, "ibl")
if not ok then
	return
end

local ok_rainbow, rainbowline = pcall(require, "indent-rainbowline")
if not ok_rainbow then
	ibl.setup()
	return
end

ibl.setup(rainbowline.make_opts({}))
