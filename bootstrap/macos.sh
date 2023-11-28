#!/bin/bash

# Mac
bootstrap () {
  xcode-select --install
  sudo xcodebuild -license accept
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/master/install.sh)"
  brew install git thefuck neovim node python3 zsh tmux curl wget stow
  brew install --cask google-chrome flutter
  sudo chsh -s $(which zsh)
  chsh -s $(which zsh)
  sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
  # TODO: Install powerlevel10k
}
