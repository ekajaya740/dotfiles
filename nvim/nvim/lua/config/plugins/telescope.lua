-- import telescope plugin safely
local telescope_setup, telescope = pcall(require, "telescope")
if not telescope_setup then
  return
end

-- import telescope actions safely
local actions_setup, actions = pcall(require, "telescope.actions")
if not actions_setup then
  return
end


local path_setup, path_actions = pcall(require, 'telescope_insert_path')
if not path_setup then
  return
end

-- configure telescope
telescope.setup({
  -- configure custom mappings
  defaults = {
    mappings = {
      i = {
        ["<C-k>"] = actions.move_selection_previous,                       -- move to prev result
        ["<C-j>"] = actions.move_selection_next,                           -- move to next result
        ["<C-q>"] = actions.send_selected_to_qflist + actions.open_qflist, -- send selected to quickfixlist
      },
      n = {
        ["["] = path_actions.insert_reltobufpath_visual,
        ["]"] = path_actions.insert_abspath_visual,
        ["{"] = path_actions.insert_reltobufpath_insert,
        ["}"] = path_actions.insert_abspath_insert,
        ["-"] = path_actions.insert_reltobufpath_normal,
        ["="] = path_actions.insert_abspath_normal,
      }
    }
  },
})

telescope.load_extension("fzf")
telescope.load_extension("media_files")
