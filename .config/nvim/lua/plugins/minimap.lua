return {
  {
    "nvim-mini/mini.map",
    version = false,
    config = function()
      local minimap = require('mini.map')

      -- Setup mini.map with custom configuration
      minimap.setup({
        -- Integrations with other plugins
        integrations = {
          minimap.gen_integration.builtin_search(),
          minimap.gen_integration.gitsigns(),
          minimap.gen_integration.diagnostic({
            error = 'DiagnosticFloatingError',
            warn  = 'DiagnosticFloatingWarn',
            info  = 'DiagnosticFloatingInfo',
            hint  = 'DiagnosticFloatingHint',
          }),
        },

        -- Symbols used to display data
        symbols = {
          encode = minimap.gen_encode_symbols.dot('4x2'),
          scroll_line = '█',
          scroll_view = '┃',
        },

        -- Window options
        window = {
          side = 'right',                -- Which side to open ('left' or 'right')
          width = 20,                    -- Total width
          winblend = 25,                 -- Value between 0 and 100 for transparency
          focusable = false,             -- Whether window can be focused
          show_integration_count = true, -- Show count of integrations
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
