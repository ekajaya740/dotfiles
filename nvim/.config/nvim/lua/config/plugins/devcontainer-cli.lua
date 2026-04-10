require("devcontainer-cli").setup({
  toplevel = true,
  remove_existing_container = true,
  dotfiles_repository = "https://github.com/your-username/dotfiles.git",
  dotfiles_branch = "main",
  dotfiles_targetPath = "~/dotfiles",
  dotfiles_installCommand = "install.sh",
  shell = "bash",
  nvim_binary = "nvim",
  log_level = "debug",
  console_level = "info",
})
