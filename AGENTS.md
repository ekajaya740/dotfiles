# Agent Instructions

This document provides guidelines for AI agents and automation tools working with this dotfiles repository.

## Quick Reference

- **Source of truth**: Edit files in this repo only, never resolved paths under `$HOME`
- **Symlink management**: Use `stow` for creating/managing symlinks
- **Validation**: Always run checks before and after changes
 **Keybindings**: See [KEYBINDINGS.md](./KEYBINDINGS.md) for custom shortcuts

## Repository Structure

```
~/dotfiles/
├── nvim/.config/nvim/          → ~/.config/nvim
├── tmux/.tmux.conf             → ~/.tmux.conf
├── opencode/.config/opencode/  → ~/.config/opencode/
├── claude/.claude/             → ~/.claude
└── omp/.omp/agent/            → ~/.omp/agent (config + models only)
```

## Workflow

### Making Changes

1. Edit files in `~/dotfiles/` only
2. Changes are immediately reflected via symlinks
3. Validate before committing

### Validation Checklist

```bash
# Syntax validation
jq empty opencode/.config/opencode/*.json

# Verify symlinks
ls -l ~/.config/nvim ~/.tmux.conf ~/.config/opencode/ ~/.claude/

# Test configs
nvim --headless -c 'quit' 2>/dev/null && echo "nvim OK"
tmux -f ~/.tmux.conf list-keys 2>/dev/null | head -1
```

### Restowing

If symlinks break or need refresh:

```bash
cd ~/dotfiles
stow -D nvim tmux opencode claude omp  # Unstow
stow nvim tmux opencode claude omp     # Restow
```

## Safety Rules

- **Never** commit secrets, tokens, or credentials
- **Never** modify files directly in `~/.config/` or `~`
- Preserve existing user model/provider configurations unless explicitly asked
- Keep changes minimal and consistent with existing style
- Test changes in headless mode when possible

## Common Tasks

### Update OpenCode config

```bash
# Edit in repo
vim ~/dotfiles/opencode/.config/opencode/oh-my-opencode.json

# Validate
jq empty ~/dotfiles/opencode/.config/opencode/oh-my-opencode.json

# Changes apply immediately (symlinked)
```

### Update Claude config

```bash
# Edit in repo
vim ~/dotfiles/claude/.claude/CLAUDE.md

# Changes apply immediately (symlinked)
```

### Add new stow package

```bash
# Create structure
mkdir -p ~/dotfiles/<package>/.config/<package>

# Add files
# Then stow
cd ~/dotfiles && stow <package>
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Broken symlinks | `stow -D <pkg> && stow <pkg>` |
| Conflicts with existing files | Backup first: `mv ~/.config/<pkg> ~/.config/<pkg>.bak` |
| Permission denied | Ensure repo is in `~` not system paths |

## oh-my-pi (OMP)

[oh-my-pi](https://github.com/can1357/oh-my-pi) — AI coding agent for the terminal. CLI command: `omp`.

### Config Files Managed in This Repo

- `omp/.omp/agent/config.yml` → `~/.omp/agent/config.yml` (settings, model roles)
- `omp/.omp/agent/models.yml` → `~/.omp/agent/models.yml` (custom providers & models)
- `omp/.omp/agent/mcp.json` → `~/.omp/agent/mcp.json` (MCP servers)

### NOT Managed (machine-local state)

- `~/.omp/agent/agent.db` (credentials DB)
- `~/.omp/agent/sessions/` (session history)
- `~/.omp/agent/memories/` (autonomous memory)
- `~/.omp/logs/` (debug logs)

### Model Configuration

Models use the `ollama-cloud` provider (matching the OpenCode `oh-my-openagent.json` pattern):

| Role | Model | Purpose |
|------|-------|---------|
| default | `ollama-cloud/glm-5.1:cloud` | Primary agent |
| smol | `ollama-cloud/minimax-m2.7:cloud` | Quick/light tasks |
| plan | `ollama-cloud/kimi-k2.6:cloud` | Planning & architecture |
| commit | `ollama-cloud/minimax-m2.7:cloud` | Commit generation |

### Update OMP config

```bash
# Edit in repo
vim ~/dotfiles/omp/.omp/agent/config.yml
vim ~/dotfiles/omp/.omp/agent/models.yml

# Validate YAML syntax
python3 -c "import yaml; yaml.safe_load(open('omp/.omp/agent/config.yml')); print('config.yml OK')"
python3 -c "import yaml; yaml.safe_load(open('omp/.omp/agent/models.yml')); print('models.yml OK')"

# Changes apply immediately (symlinked)
# Restart omp to reload: /config reload or restart session
```

### Stowing

Run `omp` at least once before stowing to create `~/.omp/agent/` with local state:

```bash
cd ~/dotfiles
stow omp
```

### MCP Servers

Configured in `omp/.omp/agent/mcp.json` (oMP) and `opencode/.config/opencode/opencode.json` (OpenCode):

| Server | Type | Command | Purpose |
|--------|------|---------|---------|
| lightpanda | stdio | `lightpanda mcp` | Native headless browser MCP — markdown, semantic tree, structured data, JS eval |
| grep_app | stdio | `bunx -y @modelcontextprotocol/server-github` | GitHub API access |

**[Lightpanda](https://lightpanda.io)** must be installed separately. The binary at `~/.local/bin/lightpanda` exposes a native MCP server:

```bash
# Install (see https://lightpanda.io/docs/quickstart/installation-and-setup)
# Then verify:
lightpanda --version
```

## Neovim Plugin Notes

- **Mason**: Use `mason-org/mason.nvim` (renamed from `williamboman/mason.nvim`)
- **LSP**: LazyVim's built-in LSP stack is used (nvim-lspconfig, mason-lspconfig, nvim-cmp)
- **Java**: Uses `nvim-java/nvim-java` (wraps jdtls with code actions, DAP, Spring Boot, test runner); NOT managed via Mason/lspconfig

## rest.nvim HTTP Client

This dotfiles includes [rest.nvim](https://github.com/rest-nvim/rest.nvim) - a powerful HTTP client for Neovim. It allows you to run HTTP requests from within the editor using `.http` files.

### Basic Usage

1. **Create an HTTP file**: Create a file with `.http` extension (e.g., `api_test.http`)
2. **Write requests**: Use the Intellij HTTP client spec format
3. **Run requests**: Place cursor on a request and run `:Rest run` or press `<leader>rr`

### HTTP File Syntax Example

```http
### GET request
GET https://api.example.com/users

### POST request with body
POST https://api.example.com/users
Content-Type: application/json

{
  "name": "John Doe",
  "email": "john@example.com"
}

### Request with query parameters
GET https://api.example.com/search?q=query&page=1

### Request with custom headers
GET https://api.example.com/protected
Authorization: Bearer your-token-here
```

### Available Commands

| Command | Description |
|---------|-------------|
| `:Rest run` | Run request under cursor |
| `:Rest run {name}` | Run request by name (e.g., `### name`) |
| `:Rest last` | Run last request |
| `:Rest open` | Open result pane |
| `:Rest env select` | Select `.env` file for variables |
| `:Rest env show` | Show current env file |
| `:Telescope rest select_env` | Pick env file via Telescope |

### Keybindings

| Key | Action |
|-----|--------|
| `<leader>rr` | Run request under cursor |
| `<leader>rl` | Run last request |
| `<leader>ro` | Open result pane |

### Environment Variables

rest.nvim supports `.env` files for storing variables:

1. Create a `.env` file in your project root
2. Define variables: `API_BASE_URL=https://api.example.com`
3. Use in requests: `GET {{API_BASE_URL}}/users`
4. Run `:Rest env select` to choose the env file

### Lua Scripting in Requests

```http
GET http://localhost:8000/api

# @lang=lua
> {%
local json = vim.json.decode(response.body)
print(json.message)
%}
```

### Dependencies

- `curl` (system package)
- `jq` and `tidy` (for response formatting)

### Language Servers (auto-installed via Mason)

| Language | LSP | Formatters/Linters |
|----------|-----|-------------------|
| TypeScript/JavaScript | `vtsls`, `typescript-language-server` | `prettierd`, `eslint_d` |
| Vue | `vue-language-server` (volar) | `prettierd` |
| Svelte | `svelte-language-server` | `prettierd` |
| Astro | `astro-language-server` | `prettierd` |
| React/JSX | Built-in via TS LSP | `prettierd`, `eslint_d` |
| Tailwind CSS | `tailwindcss-language-server` | - |
| Java | `jdtls` (via nvim-java) | - |
| Python | `pyright` | `ruff` |
| Go | `gopls` | `goimports`, `gofumpt` |
| Rust | `rust-analyzer` | `rustfmt` |
| C/C++ | `clangd` | `clang-format` |
| C# | `omnisharp` | - |
| PHP (Laravel/WordPress) | `intelephense` | `php-cs-fixer`, `phpcs` |
| Ruby | `ruby-lsp` | `rubocop` |
| Dart/Flutter | `dartls` | - |
| Zig | `zls` | `zigfmt` |
| Lua | `lua-language-server` | `stylua` |
| Bash/Shell | `bash-language-server` | `shfmt`, `shellcheck` |
| Docker | `dockerfile-language-server`, `docker-compose-language-service` | - |
| Prisma | `prisma-language-server` | - |
| GraphQL | `graphql-language-service-cli` | - |
| JSON/YAML | `json-lsp`, `yaml-language-server` | `prettierd` |
| HTML/CSS | `html-lsp`, `css-lsp` | `prettierd` |
