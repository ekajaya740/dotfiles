return {
  "nvim-telescope/telescope.nvim",
  dependencies = {
    "nvim-lua/plenary.nvim",
    "nvim-telescope/telescope-media-files.nvim",
  },
  config = function()
    require("telescope").setup({
      extensions = {
        media_files = {
          -- Include the filetypes you want to preview
          filetypes = { "png", "jpg", "jpeg", "mp4", "webm", "pdf" },
          -- Set the command to find files, "rg" or "fd" are popular choices
          find_cmd = "rg",
          backend = "chafa",
        },
      },
    })
    require("telescope").load_extension("media_files")
  end,
}
