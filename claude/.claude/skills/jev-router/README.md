# jev-router

Route Claude Code subagent calls through **TypeSafe Jev** (System One), via the
9router gateway, so a read-only lookup does not run on the strongest model.

Subagents inherit the session model unless Claude decides otherwise, so small
errands — counting files, finding where a value is configured — run on the
expensive model. Before each `Task`/`Agent` call this plugin asks Jev, in one
typed request, which agent type fits and what the cheapest sufficient model is.
When Jev is at least 0.8 confident that the task is a read-only lookup **and**
that `haiku` can do it, the call is rewritten to the `Explore` agent on the
`haiku` model. Everything else runs exactly as Claude Code set it up.

## Behaviour

- **One change only.** Rewrite to `Explore` + `haiku`; never raise the model,
  never touch a call already on `haiku`.
- **Fail-open.** A missing key, a Jev error, or a timeout leaves the call
  untouched.
- **Downward only.** Effort is asked for and logged but never applied — the
  original benchmark found raising effort made results worse.
- **Logged.** Every pick is appended to `~/.claude/jev-router.jsonl`, and the
  last decision shows in the status line (configured in `settings.json`).

## Configuration

| Env var | Default | Effect |
|---------|---------|--------|
| `JEV_ROUTER_MODE` | `apply` | `advise` observes without rewriting |
| `JEV_ROUTER_AGENT_MIN` | `0.8` | agent-type confidence gate |
| `JEV_ROUTER_MODEL_MIN` | `0.8` | model confidence gate |
| `JEV_ROUTER_DEBUG` | off | log to stderr |
| `JEV_API_BASE_URL` | 9router `/v1/systemone` | Jev endpoint |
| `JEV_MCP_MODEL` | `openrouter/typesafe/jev-1.13` | Jev model id |

The router reads `NINEROUTER_API_KEY` from the environment; the bundled `jev`
MCP server uses the same key via `${NINEROUTER_API_KEY}` interpolation.

## Commands

- `/jev` — show the recent routing decisions and the current mode.
