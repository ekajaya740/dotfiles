return {
  "RRethy/nvim-treesitter-endwise",
  event = "LazyFile",
  config = function()
    -- If treesitter is already loaded, we need to run config again for textobjects
    if LazyVim.is_loaded("nvim-treesitter") then
      local opts = LazyVim.opts("nvim-treesitter")
      require("nvim-treesitter.configs").setup({ endwise = opts.endwise })
    end
  end,
}
