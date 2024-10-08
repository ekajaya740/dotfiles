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
  sudo apt install stow
  stow . -v
}

runArch() {
  sudo pacman -Syu stow
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
