local telescope_simulator_setup, simulator = pcall(require, "simulator")
if not telescope_simulator_setup then
	return
end

-- configure simulator
simulator.setup({
	android_emulator = true,
	apple_simulator = true,
})

simulator.load_extension("fzf")
