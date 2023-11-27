local telescope_simulator_setup, simulator = pcall(require, "simulator")
if not telescope_simulator_setup then
  return
end

-- configure simulator
telescope_simulator_setup.setup({
  android_emulator = true,
  apple_simulator = true,
})

telescope_simulator_setup.load_extension("fzf")
