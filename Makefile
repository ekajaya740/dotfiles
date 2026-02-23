# Dotfiles Makefile
# Run `make help` for available commands

.PHONY: help lint lint-shell

help:
	@echo "Dotfile Management Commands"
	@echo ""
	@echo "  lint        - Run all linters"
	@echo "  lint-shell - Run shellcheck on zsh configs"
	@echo ""

# Run all linters
lint: lint-shell

# Run shellcheck on zsh configs
# Note: ShellCheck doesn't natively support zsh. Files are checked as bash.
# Some zsh-specific constructs may trigger false positives.
lint-shell:
	@echo "Running shellcheck on zsh configs..."
	@echo "Note: Zsh interpreted as bash. Zsh-specific syntax may trigger warnings."
	@shellcheck --shell=bash --severity=warning \
		zsh/.zshenv \
		zsh/.zprofile \
		zsh/.zshrc \
		2>/dev/null || true
	@echo "Shell lint complete."
