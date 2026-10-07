# Changelog

Releases of these dotfiles are cut from this file: the top `## [x.y.z]` section
below is what the next release announces. Pushing a new version heading to
`main` makes CI tag `dotfiles-vX.Y.Z` and publish a GitHub release from that
section's notes — see [AGENTS.md](./AGENTS.md#releases).

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-10-06

First tagged snapshot of the dotfiles.

### Added

- **Release automation.** `CHANGELOG.md` plus `.github/workflows/release.yml`
  tag `dotfiles-vX.Y.Z` and publish a GitHub release whenever a new version
  heading lands on `main`, with `scripts/release_dotfiles.py` doing the
  comparison against existing tags.
- **Validation workflow.** `.github/workflows/validate.yml` checks the tree on
  every push and pull request: ShellCheck on the shell scripts, JSON parsing of
  every config, YAML parsing of the harness configs, and a `stow --simulate`
  dry run of all packages against a scratch target.
- **Selective stowing.** `bootstrap.sh` and `sync-dotfiles.sh` accept
  `--only a,b,c` plus the `--harness` / `--editor` / `--shell` group shortcuts,
  so a machine can take just the harness configs. `scripts/packages.sh` is now
  the single source of truth for the package lists and the `--no-folding` rule,
  shared by both installers and the CI validator.
- **DeepSeek Harness (`dsh`) package.** Syncs only the home-level
  `~/.dsh/cordis.patch.yml`; `~/.dsh` also holds `profiles/`, `logs/` and
  `.credentials.yaml`, so the package is stowed with `--no-folding` and the
  root `.gitignore` excludes everything else under `dsh/.dsh/`. `dsh` is pinned
  in `bootstrap.sh` via the mise npm backend (`DSH_VERSION` overrides), pinned
  rather than `@latest` because it is a developer preview with declared
  compatibility-breaking changes.
- **In-process multi-agent swarm.** The `subagent` /
  `subagent-spawn-in-process` / `subagent-fork-in-process` providers and the
  `tool-subagent` / `tool-subagent-control` delegation tools ship in
  `dsh-base`, so the native swarm needs no extra packages. Per-subagent model
  selection is first-party too (`modelSelectionSettings` on the delegation
  tool), so mirroring omp's `modelRoles` needs no plugin. Codex and Claude Code
  backends are absent from the pinned release — the preset carries their tool
  rows as `disabled: true` — so nothing shells out to another harness.
- **Kanban.** `@dsh-suite/plugin-team-board` provides a shared board
  (`ctx.teamBoard`) with `task_create` / `task_claim` / `task_update` /
  `task_list` / `task_delete`, visible across sessions and subagents and
  persisted to `$DSH_HOME/team-board/board.json`, alongside first-party
  `dsh-tool-workflow` for orchestration — the two pieces that together cover
  hermes' board-plus-dispatcher behaviour. In `web`, model-facing tools are
  owned by the agent preset, so its tools must be verified in a real session
  before being relied on.
- **Multi-profile setup.** `web` (browser UI) and `headless` (one-shot CLI) are
  the two surfaces; dsh's native profiles are stronger than hermes' because
  plugins are per-profile. Profile trees are pnpm projects and stay
  machine-local, which is why only the home patch is tracked.
- **Telemetry opted out of all three egresses.** `session-log-deepseek`
  (the one carrying message text) and `plugin-package-inventory-deepseek` both
  default to `enabled: true` and are switched off with `enabled: false` in the
  home patch. The third, `session-telemetry-otel`, cannot be disabled from
  config — dsh documents that `enabled: false` does nothing for it — so it uses
  `DSH_TELEMETRY_DISABLED=1` in `zsh/.zshenv`.

### Changed

- Third-party agent skills are no longer vendored in this repository; they are
  managed in the separate [`ekajaya740/skills`](https://github.com/ekajaya740/skills)
  collection repo and installed into `~/.agents/skills`.
- Hermes config adopted the v49 schema.

### Fixed

- `omp` was missing from `STOW_NO_FOLDING` in `bootstrap.sh` and
  `sync-dotfiles.sh`, so on a machine without an existing `~/.omp` a plain
  `stow omp` folded the whole directory into one symlink into the repo and the
  agent wrote its databases and sessions into git. Both scripts now list
  `omp pen`, matching what `AGENTS.md` and `README.md` already documented.
- `bootstrap.sh` called `err` from its argument parser before `err` was
  defined, so an unknown flag printed `err: command not found` and exited 127
  instead of reporting the flag. The utilities are now defined first.
- `bootstrap.sh` parsed `--adopt`/`-f`/`--force` but never passed them to
  `stow_packages`, leaving the "use --adopt to replace" hint with no way to
  act on it; the flag is now wired through the CLI.
- `bootstrap.sh --sync-only` advertised "only restow symlinks" but still ran the
  toolchain setup first, so a plain restow could upgrade mise-managed tools. It
  now skips mise, oh-my-zsh, p10k and fzf.
- `bootstrap.sh` shifted twice per flag, so any single-flag run such as
  `--skip-deps` fell off the end of argv and died under `set -u` with no
  message. Each arm now consumes exactly its own arguments.
- `scripts/validate.sh` carried its own copy of the package lists, so its
  `stow --simulate` dry run silently stopped covering new packages. It now
  sources `scripts/packages.sh`.

[1.0.0]: https://github.com/ekajaya740/dotfiles/releases/tag/dotfiles-v1.0.0
