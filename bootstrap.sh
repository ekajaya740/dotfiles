#!/bin/bash

# Mac
mac_bootstrap () {
  xcode-select --install
  sudo xcodebuild -license accept
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/master/install.sh)"
  brew install git thefuck neovim node python3 zsh tmux curl wget stow
  brew install --cask google-chrome flutter
  sudo chsh -s $(which zsh)
  chsh -s $(which zsh)
  sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
  # Install powerlevel10k
}

# Debian
debian_bootstrap () {
  sudo apt update
  sudo apt install vim net-tools git thefuck node python3 zsh python3 tmux curl wget netcat stow
  sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
}

# Arch
# arch_bootstrap () {
#
# }


echo "OS Type: $OSTYPE"

if [[ "$OSTYPE" == "darwin"* ]]; then
  echo "Run bootstrap for Mac"
  mac_bootstrap
fi

