# Changelog

Releases of these dotfiles are cut from this file: the top `## [x.y.z]` section
below is what the next release announces. Pushing a new version heading to
`main` makes CI tag `dotfiles-vX.Y.Z` and publish a GitHub release from that
section's notes — see [AGENTS.md](./AGENTS.md#releases).

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.8.0] - 2026-10-27

### Added

- **The dsh Web UI is reachable passwordless on the MagicDNS name**:
  `https://magicdns.example.ts.net:8444`. A third listener on the existing
  `dsh.workofekajaya.com` vhost binds `100.64.0.10:8444` with the tailscale
  cert, forwards `$http_host` and includes a per-authority cookie snippet, so
  opening the URL lands in the harness with no prompt and no `?token=` exchange.
  `tailscale serve` cannot be used instead: dsh answers `401` to any request
  without its authority-bound cookie and `403` to any `/api` request whose Host
  is not in `trustedHosts`, and Tailscale's proxy injects neither (measured
  through it: html `401`, api `403`). Port `:8444` rather than `:443` because
  MagicDNS `:443` already selects the `nine-router-tailscale` vhost and nginx
  matches the listen address+port before `server_name`. The port is also
  load-bearing in two other places: `$http_host` (not `$host`) keeps `:8444` in
  the proxied Host because the fence compares `new URL(Origin).host` verbatim,
  and `dsh web --trusted-host magicdns.example.ts.net:8444` now declares the
  same authority on the service.

### Changed

- **`dsh-web-cookie-refresh` mints one snippet per authority.** The cookie name
  is `dsh-auth-<sha256(authority)>`, so a single shared snippet would break
  whichever authority was minted last — and the second authority
  (`magicdns.example.ts.net:8444`) would have overwritten the snippet the
  working `dsh.workofekajaya.com` listener includes. Both files
  (`dsh-web-cookie.conf`, `dsh-web-cookie-tailnet.conf`) are now written in one
  run behind a single `nginx -t` and reload.

## [1.7.0] - 2026-10-26

### Changed

- **9Router combo strategy back to `fallback`**, and the smart router retired
  from all 54 combo rows. The judge was being asked to rank combo members via
  `buildChoiceCriteria()`, which maps every model to a bare `null` — it saw no
  price, latency, or cache rate, only vendor names. Measured confidence across
  20 recorded calls was 0.07–0.58 (p50 ≈ 0.13), so the 0.8 default rejected the
  answer and the request fell through to the cheapest-first order anyway, after
  paying a ~500 ms round trip on every first turn. A rejection also never writes
  a sticky entry, so the `strict` lock could never engage and the judge was
  re-consulted on every turn rather than once per session.

  None of the four heterogeneous combos could be improved by a router: `coder`,
  `advisor` and `personal-chat` differ only by which provider serves the same
  `deepseek-v4.1-flash`, and `smol`'s members are a free 31B and a paid flash.
  Member order already encodes the policy, so the router only added latency and
  a failover-into-`minimax` class of failure mode.
- **`refuseless/deepseek-v4.1-flash-fast` dropped** from `coder`, `advisor` and
  `personal-chat`. It answers `HTTP 503` wrapping `402 insufficient_credits`,
  so it was a third fallback that could only ever fail.
- `9router/ensure-settings.py` now enforces `comboStrategy: "fallback"`,
  downgrades any leftover `smart` combo row (dropping its dead `smartPolicy`,
  `routerModel`, `confidenceThreshold`, `judgeModel` keys), and fails the
  read-back check if a smart row survives.
- `scripts/validate.sh` asserts the new policy and rejects any combo row still
  on `fallbackStrategy: "smart"`.

### Fixed

- **`/dashboard/combos` rendered `This page couldn't load`.** The page chunk
  used `<Link href=...>` for the *Configure* link to `/dashboard/media-providers`
  without importing it — `next/link` appears nowhere in the original bundle — so
  the route threw on first render and hit the error boundary. Added
  `import Link from "next/link";` and rebuilt the served chunk.

## [1.6.0] - 2026-10-26

### Added

- **The dsh profile config is versioned, as a seed rather than a symlink.**
  `~/.dsh/profiles/{web,headless,tui}/` held real config that existed nowhere
  else: the MCP rows for Hevy and arXiv, the `dsh-auto-archive` schedule, the
  `hmr` row that `patchReload: "live"` requires, and the 9router
  `llm-deepseek`/`agent-default-model` pair. Rebuilding them by hand was the
  only recovery path. They are now tracked at
  `dsh/.dsh/profiles/<name>/{cordis.patch.yml,package.json,pnpm-workspace.yaml,compatibility.json}`
  and copied in by `dsh/install.sh --profiles`; `--capture` copies live edits
  back after a settings change in the dashboard. Seeding rather than stowing is
  forced by dsh itself: it writes config with `writeFileAtomic`, whose
  `rename()` replaces a symlink instead of writing through it, so a stowed link
  would be silently severed on the first save or `dsh plugin add`.

- **The web UI's cookie is re-minted on a timer instead of by hand.**
  `dsh/bin/dsh-web-cookie-refresh` reads the durable browser-session secret from
  `~/.dsh/.credentials.yaml`, signs a 25-day cookie for
  `dsh.workofekajaya.com`, writes it as `/etc/nginx/snippets/dsh-web-cookie.conf`
  (a `proxy_set_header Cookie` the vhost `include`s) and reloads nginx.
  `dsh-web-cookie.timer` runs it `OnBootSec=2min` and daily, well inside the
  cookie's own window — so a restart no longer means opening a fresh `?token=`
  URL. Tracked alongside it: `dsh-web-cookie.{service,timer}` and the
  `dsh.workofekajaya.com` nginx vhost (a tracked copy; `/etc/nginx` is
  root-owned, so installing it stays a manual `cp`).

### Changed

- **`validate.sh` asserts that the dsh profiles are *not* stowed.** The
  exclusion lives in `dsh/.stow-local-ignore`, whose patterns match against a
  `"/"`-prefixed package-relative path — get that wrong and the pattern silently
  matches nothing, re-arming the `rename()` bug above. The gate runs
  `stow --simulate -v dsh` and fails if any `LINK: .dsh/profiles` line appears,
  so the outcome is asserted rather than the pattern trusted.

- **The YAML check loads `!!js` tags.** The profile seeds carry
  `HEVY_API_KEY: !!js process.env.HEVY_API_KEY`, which PyYAML rejects with
  `could not determine a constructor for the tag` — a permissive loader now
  registers it so the file is still syntax-checked.

- **`AGENTS.md` is back under the 65,536-byte instruction budget.** It had grown
  to 68,739 bytes, at which point the harness truncates the tail and the last
  sections stop reaching the agent. The rest.nvim manual (3.3 KB) and the
  GenOffice manual (6.9 KB) moved to `docs/rest-nvim.md` and `docs/genoffice.md`
  behind short pointers, and a duplicated `llm-deepseek` YAML block was
  collapsed. 68,739 → 59,172 bytes.

## [1.5.0] - 2026-10-26

### Changed

- **The skill catalogue is trimmed to what this host can actually run.** omp
  was injecting all 66 skill blocks into the system prefix of every request —
  23,449 bytes ≈ 5,862 tokens, measured against omp's own template. 25 of those
  skills cannot work here: the 10 `jev-*` ones shell out to a `jev` CLI that is
  not on PATH, the 8 `loopx*` ones need a `loopx` binary that is not on this
  filesystem at all, and `apple-apps`/`gws-*`/`gif-search`/`linear`/`spotify`/
  `kanban-operations` are macOS-only or need absent tooling. They are now listed
  under `skills.ignoredSkills`, which drops them by glob so new skills in those
  families are covered without editing the list. The catalogue is 41 skills /
  14,233 bytes ≈ 3,558 tokens — **39% smaller, ~2,304 tokens saved per request**.
  `skills.enableAgentsUser` goes back to `true`: 1.4.0's blanket "disable every
  source" dropped the utility skills too, which was further than intended.

- **`bootstrap.sh` now enforces the 9router settings instead of assuming them.**
  `settingsRepo.js` defaults `rtkEnabled` to true, but `chat.js` reads the
  *stored* blob and `mergeWithDefaults` never writes defaults back — so a
  settings row older than RTK runs with tool-output compression silently OFF,
  and the only symptom is a larger bill. `comboStrategy` is the same shape of
  bug: absent means `fallback`, which gives up the sticky session and re-pays
  the prompt cache on every failover. The new `9router/ensure-settings.py`
  PATCHes `rtkEnabled: true` and `comboStrategy: "smart"`, reads them back, and
  is idempotent; `bootstrap.sh` runs it and warns (never aborts) when the
  gateway is not up yet. This closes the gap where `validate.sh` could assert
  the values in the snapshot while a fresh machine still booted without them.

### Fixed

- **`validate.sh` asserted a skill policy nobody wanted.** Its invariants gate
  required all seven `enable*` flags to be false, which is exactly the
  over-prune described above. It now requires `enableAgentsUser: true`, the
  remaining sources false, and `jev-*`/`loopx*` present in `ignoredSkills`.
  Negative-tested: clearing `ignoredSkills` or flipping `enableAgentsUser` both
  fail the gate.

## [1.4.0] - 2026-10-26

### Changed

- **Claude Code is back on Anthropic's own API.** 1.3.0 pointed
  `ANTHROPIC_BASE_URL` at the 9router gateway and mapped `coder`/`advisor`/`smol`
  onto the Sonnet/Opus/Haiku aliases. That replaced an existing Claude
  subscription with gateway spend, so it is reverted: `settings.json` no longer
  sets `env`, `apiKeyHelper`, or any `ANTHROPIC_*` model alias, and `claude`
  authenticates from its own `~/.claude/.credentials.json` again. Claude Code is
  now the one harness here that does not ride 9router. The `jev-router` plugin
  still uses 9router SystemOne — it is a routing hook, not the model path.

- **`claude/install.sh` deletes retired managed keys instead of unioning them.**
  The merge was `{**live, **template}`, so a setting dropped from the template
  stayed alive in `~/.claude/settings.json` forever — which is exactly how the
  `ANTHROPIC_BASE_URL` above would have outlived its own removal. The script now
  pops `env` (narrowed to a `RETIRED_ENV` list, so hand-added vars survive),
  `apiKeyHelper`, and `statusLine` when the template does not define them.

## [1.3.0] - 2026-10-26

### Added

- **Dedicated `smol` combo for the cheap roles.** omp's `smol` and `tiny` roles
  were pointed at `9router/coder` — a 500k-context combo that reached
  `ollama-cloud/minimax-m3.1-flash:cloud` first. The new `smol` combo is
  `[ollama-cloud/gemma4:31b, ollama-cloud/deepseek-v4.1-flash:1017-cloud]`.
  `ollama-cloud/gemma4:31b` is the only candidate measured to pass 66/66 skill
  description compressions at 0.7 s p50 and $0.00. Both roles now point at
  `9router/smol`. OpenRouter's `google/gemma-4-31b-it:free` was tried first and
  dropped: the workspace guardrail had to be widened from `typesafe` to admit
  Google AI Studio, and the free pool then answered 429 upstream on every probe
  over ~4 minutes, adding a cooldown wait to each cold call.

### Changed

- **`ollama-cloud/*` models lead every combo.** `coder`, `advisor`,
  `personal-chat`, `designer`, `sfw-coder` and `sfw-advisor` were reordered so
  the `ollama-cloud` member comes first. `coder` previously opened on
  `shiteru-deepseek-v4.1-flash` and fell through to
  `ollama-cloud/minimax-m3.1-flash:cloud` ($0.274/M prompt tokens) whenever
  Shiteru was down — which is what turned 2026-10-20→10-23 into $1,534 of
  minimax spend. The new first member,
  `ollama-cloud/deepseek-v4.1-flash:1017-cloud`, costs $0.0054/M prompt tokens
  at a 98.6% cache rate.

- **Every harness now points its cheap/auxiliary slots at `smol`.** The combo
  was only wired into omp at first; the same traffic was still leaving
  `coder`-class models in the other four harnesses. Now: OpenCode
  (`small_model`), Claude Code (`ANTHROPIC_DEFAULT_HAIKU_MODEL`,
  `ANTHROPIC_SMALL_FAST_MODEL`), Hermes (`auxiliary.{skills_hub,approval,mcp,title_generation}`)
  and Pen (a `smol` entry in the model list). Hermes `auxiliary.vision` moved
  to `ollama-cloud/gemma4:31b` directly — it is the one vision model that is
  free and text+image capable.

### Removed

- **Dead combo entries in `omp/.omp/agent/models.yml`.** `cost-efficient`,
  `combo-profill-fast` and `combo-profill-smart` were declared as models but
  exist in no 9router `combos` row (and never appear once in `usageHistory`),
  so selecting one returned `No active credentials for provider: openai`.
  `cost-efficient` was OpenCode's *default* model, which meant a fresh OpenCode
  session failed outright — it is now `coder`, with `smol` as `small_model`.

- **`trade-agent-deep` and `trade-agent-fast` combos.** Both were unused and
  fronted by the most expensive models in the catalog (`qwen-3.8-max`,
  `glm-5.3`, `kimi-k3`).

## [1.2.0] - 2026-10-25

### Added

- **GenOffice wired to 9router and to every agent as an MCP server.** The
  desktop document suite now runs its in-app agent on the `coder` combo, and
  its 32-command CLI is registered as a stdio MCP server — `genoffice mcp` — in
  omp, OpenCode, Hermes, Claude Code, Pi and dsh. In the app this means
  `ai-settings.json` selects `provider: custom` (the default `genspark` is a
  signed-out account, and `activeProvider()` silently falls back to it when a
  custom entry is missing a model, base URL or key). The key is stored in that
  file because the app resolves `profile.apiKeyEnv` from its own `process.env`,
  which a Finder-launched app does not inherit — so the file stays
  machine-local, like `~/.pencil/agent-auth`. Verified end to end: one
  streaming turn through the app's `aiOffice.aiStream` bridge returns from
  `coder`.
  The app is a prerequisite, not a dependency the repo can install: the CLI,
  the MCP server and the agent skill all run the copy inside
  `/Applications/GenOffice.app`, so `AGENTS.md` now opens the section with the
  install steps (`brew install --cask genoffice` or the `.dmg`, first launch,
  `genoffice install-cli`) and the headless caveat for `render`/PDF conversion.

### Changed

- **`pi` is now a `--no-folding` package.** `pi/.pi/agent/mcp.json` is tracked,
  so `~/.pi/agent` must not fold into a single symlink — otherwise Pi writes
  `auth.json`, `sessions/` and `npm/` into the repo. `STOW_NO_FOLDING` gains
  `pi`, and the hand-stow instructions, package counts and layout lines in
  `AGENTS.md`/`README.md` follow.
- **Pi gains MCP support.** Pi 0.87 ships no built-in MCP, so
  `pi-mcp-extension` is installed and reads the new tracked `mcp.json`. The
  GenOffice entry sets `"lifecycle": "eager"`: the default lazy mode registers
  nothing until `/mcp:start`, which reads as "wired but dead".
- **dsh mounts exactly one MCP server.** The home patch gains an
  `mcp-genoffice` row on the bundled `@deepseek-ai/dsh-mcp-client`, so the
  document tools reach the model as `mcp__genoffice__<name>`.

### Fixed

- **`claude/install.sh` created a self-referential `jev-router` symlink.** On a
  host where `~/.claude` is itself a symlink into this repo, `PLUGIN_LINK` and
  `PLUGIN_SRC` are the same directory; the old `elif` treated the real source
  as "not a symlink", moved it to `.bak` and linked it to itself, which broke
  every read under `claude/.claude/skills/` (ELOOP) and turned `validate.sh`
  red on every sync. The same-directory case is now detected by canonicalised
  parents and is a no-op that also repairs an existing loop.
## [1.1.0] - 2026-10-23

### Added

- **Max reasoning effort selectable for Refuseless models.** Refuseless
  advertises `reasoning_efforts: [low, high, max]` per model and honors `max`
  on the wire, but 9router classifies `glm-5.3*` as `zai` and `minimax-m3.1*`
  as `minimax`, whose level lists never offer `max`. Four
  `provider/model(max)` custom-model rows (`glm-5.3-abliterated`,
  `glm-5.3-flash-abliterated`, `deepseek-v4.1-flash-fast`,
  `deepseek-v4.1-flash-abliterated`) make the level pickable in the combo
  builder; the suffix needs no source change and survives combo resolution
  (`combo.js` passes the model string through verbatim). `minimax-m3.1-flash`
  is excluded because its `minimax` format branch never emits
  `reasoning_effort`. Documented in `9router/README.md`, and the refreshed
  `config-export.json` carries the new rows.

### Fixed

- **dsh 9router routing: the route row is not the selection.** The
  `llm-deepseek` recipe in `AGENTS.md` was incomplete. A patch row registers a
  provider route; it does not make that route the one agents call. The
  selection lives in the `agent-default-model` row, which ships pointing at
  `model: deepseek-flash` — an id 9router does not serve, so a turn failed
  with `INVALID_REQUEST: [400]: deepseek-flash is not a valid model ID`. The
  documented recipe now carries both rows, and the section states that the
  `deepseek-official` route name is a fixed constant.
- **dsh 9router: the `[DONE]` sentinel is not a constraint.** `9router/README.md`
  records that 9router's translated `/v1/messages` streams close without
  `data: [DONE]`, and that the pinned dsh release's `llm-deepseek` parser
  would fail on it. It does not: the parser terminates on `message_stop` and
  throws `STREAM_CLOSED` only when that event is missing, and the string
  `without [DONE]` appears nowhere in the installed dsh. Verified 2026-10-23
  against the live gateway — a tool-calling turn completes on both the
  `coder` and `advisor` combos, and an Anthropic `tool_use` → `tool_result`
  round trip returns an answer. The section now says so, so the sentinel
  bug is not mistaken for a reason to switch adapters.

### Changed

- **dsh adapter guidance.** `@deepseek-ai/dsh-llm-pi-ai` is documented as
  shipping in `dsh-base` as row id `llm-pi-ai`, mounted dormant with zero
  routes until a `providers` map supplies them — and as the right choice for
  several providers or a chat-completions-only gateway, not for a single
  OpenAI-compatible gateway such as 9router.


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

[1.2.0]: https://github.com/ekajaya740/dotfiles/releases/tag/dotfiles-v1.2.0
[1.1.0]: https://github.com/ekajaya740/dotfiles/releases/tag/dotfiles-v1.1.0
[1.0.0]: https://github.com/ekajaya740/dotfiles/releases/tag/dotfiles-v1.0.0
