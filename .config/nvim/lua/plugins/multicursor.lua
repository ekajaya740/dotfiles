return {
  {
    "smoka7/multicursors.nvim",
    dependencies = {
      "nvimtools/hydra.nvim",
    },
    opts = {},
    cmd = { "MCstart", "MCvisual", "MCclear", "MCpattern" },
    keys = {
      { mode = { "v", "n" }, "<Leader>m", "<cmd>MCstart<cr>", desc = "Start multicursor" },
    },
  }
}
