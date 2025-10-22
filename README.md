## Bootstrap

Run `./bootstrap.sh` to install GNU stow (if needed) and symlink packages into your home directory. The script auto-detects macOS, Arch, Debian/Ubuntu, Void, and MSYS2/Git Bash on Windows. On other platforms the script attempts a best-effort install and prompts if manual steps are required.

During bootstrap a small set of CLI tools is installed when possible (`stow`, `tree-sitter` CLI, `hadolint`, `fzf`, `lazygit`, and `lazydocker`). If a package manager is not available for one of them you will see a warning so you can finish the install manually.

Pass `--skip-tools` (or export `BOOTSTRAP_SKIP_TOOLS=1`) to bypass these installations when you only want to manage symlinks or are offline.

By default it links every top-level directory in the repository (excluding `bootstrap/`). To explicitly control the set of packages, export `STOW_PACKAGES` before running the script, for example:

```bash
STOW_PACKAGES=".config .tmux .vscode" ./bootstrap.sh
```

Set `STOW_TARGET` to override the destination directory. The default is your `$HOME`.

Run `bash tests/run.sh` to execute a lightweight test suite that exercises OS detection and stow linking helpers.
