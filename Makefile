# Dotfiles Makefile
# Run `make help` for available commands

.PHONY: help lint lint-shell validate release-check

help:
	@echo "Dotfile Management Commands"
	@echo ""
	@echo "  validate      - Run every check (ShellCheck, JSON, YAML, stow dry run)"
	@echo "  lint          - Alias for validate"
	@echo "  lint-shell    - Run shellcheck on zsh configs only"
	@echo "  release-check - Show whether a release is due"
	@echo ""

# The full check suite; this is exactly what CI runs.
validate:
	@./scripts/validate.sh

# Kept as the historical name for the full suite.
lint: validate

# ShellCheck on the zsh configs alone.
# Note: ShellCheck doesn't natively support zsh. Files are checked as bash, so
# zsh-specific constructs can trigger false positives. This target is
# informational; `validate` is the gate.
lint-shell:
	@echo "Running shellcheck on zsh configs..."
	@echo "Note: Zsh interpreted as bash. Zsh-specific syntax may trigger warnings."
	@shellcheck --shell=bash --severity=warning \
		zsh/.zshenv \
		zsh/.zprofile \
		zsh/.zshrc \
		|| true
	@echo "Shell lint complete."

# Report whether CHANGELOG.md has a version with no tag yet.
release-check:
	@python3 scripts/release_dotfiles.py --check
