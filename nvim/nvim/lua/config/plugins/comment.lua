local setup, comment = pcall(require, "Comment")
if not setup then
  return
end

comment.setup({
  toggler = {
    line = "lc",
    block = "bc",
  },
  opleader = {
    line = "lc",
    block = "bc",
  },
})
