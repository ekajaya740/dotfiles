#!/bin/bash

runMac() {
  brew update
  brew install stow
  stow . -v
}

runDebian() {
  sudo apt update
  sudo apt install stow
  stow . -v
}

runUbuntu() {
  sudo apt update
  sudo apt install stow vim python3 python3-pip
  stow . -v
}

runArch() {
  sudo pacman -Syu stow vim neovim python3 docker rbenv zsh tmux dbeaver code discord gimp atac vlc wezterm

  sudo pacman -S --needed git base-devel && git clone https://aur.archlinux.org/yay-bin.git && cd yay-bin && makepkg -si

  sudo yay -Syu wps-office google-chrome mongodb-compass postman-bin raindrop zoom

  stow . -v
}

if [ -f /etc/debian_version ]; then
  if [ -f /etc/lsb-release ]; then
    runUbuntu
  else
    runDebian
  fi
elif [ -f /etc/arch-release ]; then
  runArch
elif [[ "$OSTYPE" == "darwin"* ]]; then
  runMac
else
  echo "Unknown OS"
fi
