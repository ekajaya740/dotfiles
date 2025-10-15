return {
  {
    "neoclide/coc.nvim",
    branch = "release",
    event = "BufReadPre",
    build = function()
      vim.fn.system({ "yarn", "install", "--frozen-lockfile" })

      local extensions = {
        "coc-json",
        "coc-tsserver",
        "coc-eslint",
        "coc-prettier",
        "coc-css",
        "coc-html",
        "coc-yaml",
        "coc-markdownlint",
        "coc-pyright",
        "coc-go",
        "coc-rust-analyzer",
        "coc-java",
        "coc-sumneko-lua",
        "coc-vetur",
        "coc-volar",
        "coc-lua"
      }

      vim.fn.system({ "nvim", "--headless", "-c", "CocInstall -sync " .. table.concat(extensions, " ") .. " | qa" })
    end,
    config = function()
      -- Recommended coc settings
      vim.o.backup = false
      vim.o.writebackup = false
      vim.o.updatetime = 300
      vim.o.signcolumn = "yes"

      vim.api.nvim_create_autocmd("BufWritePost", {
        pattern = "*.html",
        callback = function()
          local line = vim.api.nvim_buf_get_lines(0, 0, 1, false)[1]
          if line and line:match("<!doctype html>") then
            vim.api.nvim_buf_set_lines(0, 0, 1, false, { "<!DOCTYPE html>" })
            vim.cmd("silent write")
          end
        end,
      })


      -- Tab completion
      function _G.check_back_space()
        local col = vim.fn.col('.') - 1
        return col == 0 or vim.fn.getline('.'):sub(col, col):match("%s") ~= nil
      end

      local opts = { silent = true, noremap = true, expr = true, replace_keycodes = false }
      vim.keymap.set("i", "<TAB>",
        'coc#pum#visible() ? coc#pum#next(1) : v:lua.check_back_space() ? "<TAB>" : coc#refresh()', opts)
      vim.keymap.set("i", "<S-TAB>", 'coc#pum#visible() ? coc#pum#prev(1) : "<C-h>"', opts)

      -- Use K for hover
      vim.keymap.set("n", "K", "<CMD>call CocActionAsync('doHover')<CR>", { silent = true })

      -- GoTo code navigation
      vim.keymap.set("n", "gd", "<Plug>(coc-definition)", { silent = true })
      vim.keymap.set("n", "gy", "<Plug>(coc-type-definition)", { silent = true })
      vim.keymap.set("n", "gi", "<Plug>(coc-implementation)", { silent = true })
      vim.keymap.set("n", "gr", "<Plug>(coc-references)", { silent = true })

      vim.keymap.set("n", "<leader>ca", "<Plug>(coc-codeaction)", { silent = true, desc = "Code Action" })

      -- Code action for selected text (visual mode)
      vim.keymap.set("x", "<leader>ca", "<Plug>(coc-codeaction-selected)",
        { silent = true, desc = "Code Action (Visual)" })

      -- Quick fix (like :CocFix)
      vim.keymap.set("n", "<leader>qf", "<Plug>(coc-fix-current)", { silent = true, desc = "Quick Fix" })
      -- Make <CR> confirm completion and jump in snippets
      vim.keymap.set("i", "<CR>",
        [[coc#pum#visible() ? coc#pum#confirm() : coc#expandableOrJumpable() ? "\<C-r>=coc#rpc#request('doKeymap', ['snippets-expand-jump',''])\<CR>" : "\<CR>"]],
        opts)

      -- Keep <Tab> and <S-Tab> for snippet navigation too
      vim.keymap.set("i", "<Tab>",
        [[coc#pum#visible() ? coc#pum#next(1) : coc#expandableOrJumpable() ? "\<C-r>=coc#rpc#request('doKeymap', ['snippets-expand-jump',''])\<CR>" : v:lua.check_back_space() ? "\<Tab>" : coc#refresh()]],
        opts)
      vim.keymap.set("i", "<S-Tab>", [[coc#pum#visible() ? coc#pum#prev(1) : "\<C-h>"]], opts)
    end,
  },
}
