#!/bin/bash

bootstrap () {
  sudo apt update
  sudo apt install vim net-tools git thefuck node python3 zsh python3 tmux curl wget netcat stow
  sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
}
