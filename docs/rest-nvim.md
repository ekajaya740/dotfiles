# rest.nvim HTTP Client

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

@RTK.md

See [AGENTS.md](../AGENTS.md) for the repo-wide conventions.
