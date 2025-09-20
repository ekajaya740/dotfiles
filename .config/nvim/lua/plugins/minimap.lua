return {
  {
    "nvim-mini/mini.map",
    version = false,
    config = function()
      local map = require("mini.map")

      map.setup({
        integrations = {
          map.gen_integration.builtin_search(),
          map.gen_integration.gitsigns(),
          map.gen_integration.diagnostic(),
        },
        symbols = {
          encode = map.gen_encode_symbols.dot('4x2'),
        },
        window = {
          width = 10,
          side = "right",
        },
      })

      -- open minimap automatically
      vim.api.nvim_create_autocmd("BufEnter", {
        callback = function()
          require("mini.map").open()
        end,
      })
    end,
  }
}
