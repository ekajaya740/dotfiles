" vim-plug plugin manager
let mapleader = " "
let maplocalleader = " "

call plug#begin('~/.vim/plugged')

" File explorer
Plug 'preservim/nerdtree'

" Fuzzy finder
Plug 'junegunn/fzf', { 'do': { -> fzf#install() } }
Plug 'junegunn/fzf.vim'

" Linting and LSP
Plug 'dense-analysis/ale'

" UI
Plug 'vim-airline/vim-airline'
Plug 'vim-airline/vim-airline-themes'
Plug 'Yggdroot/indentLine'

" Editor enhancements
Plug 'jiangmiao/auto-pairs'
Plug 'tpope/vim-commentary'

call plug#end()

" =============================================================================
" Core Settings
" =============================================================================

" Line numbers
set number relativenumber

" Indentation & tabs
set tabstop=2 shiftwidth=2 expandtab autoindent

" Line wrapping
set nowrap

" Search settings
set ignorecase smartcase

" Cursor line
set cursorline

" Appearance
set background=dark
set signcolumn=yes
set termguicolors

" Backspace
set backspace=indent,eol,start

" Clipboard
set clipboard=unnamedplus

" Split windows
set splitright splitbelow

" Keyword
set iskeyword+=-

" =============================================================================
" Plugin Configuration
" =============================================================================

" NERDTree
nnoremap <leader>e :NERDTreeToggle<CR>
let g:NERDTreeShowHidden = 1

" fzf.vim
nnoremap <leader>ff :Files<CR>
nnoremap <leader>/ :Rg<CR>
nnoremap <leader>fb :Buffers<CR>

" ALE
let g:ale_linters = {
    \ 'javascript': ['eslint'],
    \ 'typescript': ['eslint'],
    \ 'python': ['ruff'],
    \ 'go': ['gofmt'],
    \ 'rust': ['rustfmt'],
    \ 'json': ['jq'],
    \ 'yaml': ['yamllint'],
\ }

let g:ale_fixers = {
    \ 'javascript': ['prettier', 'eslint'],
    \ 'typescript': ['prettier', 'eslint'],
    \ 'python': ['black'],
    \ 'go': ['gofmt'],
    \ 'rust': ['rustfmt'],
    \ 'json': ['jq'],
    \ 'yaml': ['yamlfix'],
\ }

let g:ale_fix_on_save = 1
nnoremap <leader>fm :ALEFix<CR>
nnoremap [g :ALEPrevious<CR>
nnoremap ]g :ALENext<CR>
nnoremap gd :ALEGoToDefinition<CR>
nnoremap K :ALEHover<CR>

" Airline
let g:airline_powerline_fonts = 1
let g:airline#extensions#tabline#enabled = 1

" IndentLine
let g:indentLine_char = '│'

" =============================================================================
" Keybindings
" =============================================================================

" Clear search highlights
nnoremap <leader>nh :nohl<CR>

" Delete without yank
nnoremap x "_x

" Increment/decrement
nnoremap <leader>+ <C-a>
nnoremap <leader>- <C-x>

" Window management
nnoremap <leader>sv <C-w>v
nnoremap <leader>sh <C-w>s
nnoremap <leader>se <C-w>=
nnoremap <leader>sx :close<CR>

" Tab management
nnoremap <leader>to :tabnew<CR>
nnoremap <leader>tx :tabclose<CR>
nnoremap <leader>tn :tabn<CR>
nnoremap <leader>tp :tabp<CR>

" =============================================================================
" Colorscheme
" =============================================================================

colorscheme habamax
