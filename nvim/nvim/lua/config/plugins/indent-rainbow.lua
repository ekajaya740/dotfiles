local setup, indents = pcall(require, "indent-blankline")
if not setup then
  return
end

indents.setup()
