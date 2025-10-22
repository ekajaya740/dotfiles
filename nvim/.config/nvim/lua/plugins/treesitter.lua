return {
  "nvim-treesitter/nvim-treesitter",
  dependencies = {
    "RRethy/nvim-treesitter-endwise",
    "nvim-treesitter/nvim-treesitter-textobjects",
  },
  opts = function(_, opts)
    -- Extend LazyVim's default configuration
    vim.list_extend(opts.ensure_installed, {
      "bash",
      "c",
      "html",
      "javascript",
      "json",
      "lua",
      "markdown",
      "markdown_inline",
      "php",
      "python",
      "query",
      "regex",
      "java",
      "ruby",
      "typescript",
      "vim",
      "vimdoc",
      "yaml",
    })

    -- Configure incremental selection
    opts.incremental_selection = {
      enable = true,
      keymaps = {
        init_selection = "<C-space>",
        node_incremental = "<C-space>",
        node_decremental = "<bs>",
      },
    }

    -- Configure endwise
    opts.endwise = {
      enable = true,
    }

    -- Configure textobjects
    opts.textobjects = {
      move = {
        enable = true,
        goto_next_start = {
          ["]f"] = "@function.outer",
          ["]c"] = "@class.outer",
          ["]a"] = "@parameter.inner",
        },
        goto_next_end = {
          ["]F"] = "@function.outer",
          ["]C"] = "@class.outer",
          ["]A"] = "@parameter.inner",
        },
        goto_previous_start = {
          ["[f"] = "@function.outer",
          ["[c"] = "@class.outer",
          ["[a"] = "@parameter.inner",
        },
        goto_previous_end = {
          ["[F"] = "@function.outer",
          ["[C"] = "@class.outer",
          ["[A"] = "@parameter.inner",
        },
      },
    }

    return opts
  end,
}
