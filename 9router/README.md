# 9Router Config Backup

Auto-exported snapshot of the 9Router gateway (VPS `9router.service`, port 20128, v0.5.104).
This is the **personal instance** (data dir `/home/user/9router/data/`).

## Files

- `config-export.json` — nodes, connections, custom models, combos, settings.
  Credential-named fields (`apiKey`, `token`, `secret`, …) are **dropped**, not
  masked: the snapshot carries no key material at all. A value-shaped gate over
  the finished document (`SECRET_RE` in `export_9router.py`) aborts the export if
  a key prefix survives anywhere — `sk-*`, `gh*_`, `AKIA*`, JWT, PEM — so real
  keys never leave the VPS.

## Restore (disaster recovery)

Recreate everything through the API (real keys required — re-enter them manually):

```bash
# login cookie first (see 9router-admin skill), then:
POST /api/provider-nodes       # each node (name, prefix, apiType: chat, baseUrl, type: openai-compatible)
POST /api/providers            # each connection {provider: <nodeId>, apiKey: <REAL KEY>, name}
POST /api/models/custom        # each custom model {providerAlias, id, type: llm, name}
POST /api/combos               # each combo {name, models: [...], kind: llm}
```

## Refresh

Regenerate from the live gateway whenever provider/model/combo topology changes:

```bash
bash /home/user/dotfiles/9router/export.sh   # or: python3 .../export_9router.py
cd /home/user/dotfiles && git add 9router && git commit -m "backup 9router config" && git push
```

## nginx answers the CORS preflight for `/v1/*` (fixed 2026-10-16)

Browser clients on another origin could not reach the gateway at all — every request died with
"could not reach the provider", even with a correct key. (The original reporter was the
self-hosted OpenPencil app at `pen.workofekajaya.com`; that hosting was removed 2026-10-17. The
gateway fix below is origin-agnostic and stays.)

**Root cause.** `app/src/dashboardGuard.js` runs as Next.js *middleware*, which executes before
routing. For any path in `PUBLIC_PREFIXES` (`/v1`, `/v1beta`, `/api/v1`, `/api/v1beta`, `/codex`,
`/responses`) it does:

```js
if (isPublicLlmApi(pathname)) {
  if (await canAccessPublicLlmApi(request)) return NextResponse.next();
  return NextResponse.json({ error: "API key required for remote API access" }, { status: 401 });
}
```

`canAccessPublicLlmApi` is `isLocalRequest(request) || hasValidCliToken(request) || hasValidApiKey(request)`.
A browser **never** attaches credentials to a CORS preflight, so the `OPTIONS` got that 401 — and a
401 carries no `Access-Control-Allow-*` headers, so the browser refused to send the real `POST`.
The route's own working `OPTIONS` handler at `app/src/app/api/v1/chat/completions/route.js:19`
was unreachable: middleware wins. **The 401 was the guard, not a bad key** — a keyless `POST`
correctly still returns 401.

**Fix — `location /` in `/etc/nginx/sites-available/ai.workofekajaya.com` answers `OPTIONS`
locally**, so the preflight never reaches the guard:

```nginx
if ($request_method = OPTIONS) {
    add_header Access-Control-Allow-Origin  "*" always;
    add_header Access-Control-Allow-Methods "GET, POST, OPTIONS" always;
    add_header Access-Control-Allow-Headers "*" always;
    add_header Access-Control-Max-Age       "86400" always;
    add_header Content-Type                 "text/plain" always;
    return 204;
}
```

Applied from `/home/user/9router/scripts/ai.workofekajaya.com.conf` (full file). Pre-change
copy: `/root/nginx-backups/20261016-162702/` (rollback = `cp` back + `nginx -s reload`). The
standalone snippet file that used to sit beside it, `scripts/pen-cors-nginx-snippet.conf`, was
deleted 2026-10-17 with the rest of the OpenPencil-hosting artifacts; the block itself is quoted
above and lives in the ai vhost.

**This is edge-only, which is why it is the right layer.** The real request still traverses the
same guard and still needs its `Authorization` header — the keyless `POST` still 401s, so this is
not an open relay. No 9router source, build artifact, or restart is involved, so the documented
"[DONE] sentinel needs a rebuild" trap below does not apply and no `git` tree is dirtied.

**Scope note.** The `if` sits in `location /`, so it matches `OPTIONS` on *every* path of this
vhost, not only `/v1/*`. That is safe here: only cross-origin calls preflight, the dashboard is
same-origin with itself, and a blanket `204 + ACAO: *` never bypasses auth on the real request.

**Do not "fix" this in `dashboardGuard.js`.** Patching the source *and* the prebuilt
`.next/**/middleware.js` and restarting was evaluated and rejected: `9router.service` is
`Restart=on-failure`, so the self-shutdown route (`killAppProcesses()` → `exit(0)`) would leave
the gateway **permanently down** with no respawn, and a source patch blocks
`scripts/9router-update.sh`, which refuses to run on a dirty tree.

**Verify from a browser, not curl** — curl proves the endpoint, not CORS. An `OPTIONS` preflight
with any cross-origin `Origin` must show 204 + `access-control-allow-origin: *`:

```bash
curl -sD- -o /dev/null -X OPTIONS https://ai.workofekajaya.com/v1/chat/completions \
  -H "Origin: https://example.com" -H "Access-Control-Request-Method: POST"
```

## Custom models are keyed twice — add under BOTH aliases (verified 2026-10-19)

An `openai-compatible` provider has two identifiers, and different parts of 9router use
different ones:

| Consumer | Key used |
|---|---|
| routing, `/v1/models`, `/api/models` | the node **prefix** (`ollama-cloud`) |
| dashboard provider page, enable/disable toggle | the node **id** (`openai-compatible-chat-f69d9eee-…`) |

`app/src/app/(dashboard)/dashboard/providers/[id]/page.js:189` sets
`providerStorageAlias = isCompatible ? providerId : providerAlias`, and
`app/src/shared/utils/providerCustomModels.js:15` drops every row where
`model.providerAlias !== providerAlias`. So a model added only under the prefix routes fine
and is missing from the dashboard's model list — the model looks "not installed" even though
clients can already call it.

When adding an Ollama Cloud model, POST both:

```bash
POST /api/models/custom  {"providerAlias":"ollama-cloud","id":"<model>","type":"llm","name":"<name>"}
POST /api/models/custom  {"providerAlias":"openai-compatible-chat-f69d9eee-df38-4add-9a67-b7028c4a994a","id":"<model>","type":"llm","name":"<name>"}
```

A row under the node id is harmless: `/v1/models` dedupes on the prefix, and
`<nodeId>/<model>` routes to the same upstream.

## Notes

- Shared-key (rotating) models: keys change often. Always re-export after a key rotation so
  the masked tails in the backup stay meaningful for cross-checking.
- Combos referenced by name from each harness config (`shiteru-*`, etc.).
  Keep combo names stable — renaming breaks profile `model.default` references.

## Claude models cannot run agent turns on this key (verified 2026-10-12)

**Do not put a Claude model in an agent-facing combo.** Every shiteru Claude route
forwards to one upstream that rejects any conversation *history* containing a
tool block, so an agent works only until its first tool call and then every
follow-up turn fails:

```
[400]: {"error":{"message":"Provider rejected the request",
                 "type":"api_error","code":"upstream_error"}}
```

Bisected against `ai.shiteru.id` **directly, with the connection's own key** (so
9router and dsh are both out of the picture). Passing tool *definitions* is fine,
and the model happily *emits* a tool call — but feeding that call back is refused:

| Request | Result |
|---|---|
| `tools` defined + plain text | 200 |
| model asked to use a tool; it emits `tool_use` | 200 |
| assistant `tool_use` in history | **400** |
| `tool_result` in a user message | **400** |
| `tool_result` with `is_error` | **400** |
| plain multi-turn (no tools) | 200 ← control |
| `thinking` blocks / system as blocks / `cache_control` | 200 |

It is **not** a transport problem: it reproduces identically on the native
Anthropic Messages API (`/v1/messages`, `anthropic-compatible` node) and on the
OpenAI chat shape (openai-compatible node). It is upstream and not fixable here.
Only `claude-sonnet-4.6` is even *eligible* on this key — every other Claude id
(sonnet-5, opus-4.6/4.7/4.8/5, fable-5, fable-5.1) answers `403`.

The other Claude-capable upstreams are dead for the same purpose:
`floodgate/*` → 403 "balance is empty", `tabitoken/*` → 500, `modelrouter/*` → TLS 502.

**Practical rule:** use Claude for chat only. Agent-facing combos (`coder`,
`personal-chat`, `advisor`) must use a tool-capable model — deepseek, glm, kimi
and qwen all accept `tool_calls` and are verified working.

## Reasoning effort in combos: the `model(level)` suffix

Reasoning level is a **client-declared request parameter**, not gateway state.
9router forwards it and logs the level it resolved as `THINK:<level>`. The
level rides in the model string as a suffix — `provider/model(level)` — which
is the established convention here (`shiteru/deepseek-v4.1-flash(high)` in
`config-export.json`). `combo.js` splits on the first `/` and passes the rest
through verbatim, so the suffix survives combo resolution.

Refuseless (`openai-compatible` node) advertises `reasoning_efforts:
[low, high, max]` per model and accepts `max` on the wire. Because the node is
`openai-compatible`, requests take the PASSTHROUGH path and `reasoning_effort`
reaches upstream — confirmed by `THINK:max` in the gateway log.

Four `(max)` custom-model rows exist so the level is pickable in the combo
builder, rather than needing a hand-edited combo string:

```
refuseless/glm-5.3-abliterated(max)
refuseless/glm-5.3-flash-abliterated(max)
refuseless/deepseek-v4.1-flash-fast(max)
refuseless/deepseek-v4.1-flash-abliterated(max)
```

The picker lists them under the raw node id
(`openai-compatible-chat-aa806b9c-…/glm-5.3-abliterated(max)`) because a custom
row's `providerAlias` is the node id and the route sets `routedModel =
fullModel`. Both forms route identically — both were tested. Unlike the
`ollama-cloud` case above, no prefix-alias twin is needed here: the rows were
added under the node id, which is what the provider page and the combo builder
read, and `/v1/models` still lists them via the prefix form.

**`minimax-m3.1-flash` is deliberately excluded.** It advertises `max` upstream
and the suffix is accepted, but 9router classifies it `thinkingFormat:
"minimax"`, and that branch in `thinkingUnified.js` emits only
`body.thinking = {type:"adaptive"}` — it never writes `reasoning_effort`, so
the level is silently dropped (`THINK:auto`). Reasoning-length variance on that
model is sampling noise, not effort. Enabling `max` there needs a
`thinkingFormat` reclassification, i.e. a source change.

**Why not fix the picker in source.** `thinkingLevels.js` maps `zai` →
`["thinking"]` and `minimax` → `["none","thinking"]`, so `max` is never offered
for those families. The service runs from the bundled
`.next/standalone` (`custom-server.js`), so editing `app/src/**` has no runtime
effect, and `~/9router/app` has no `.git` to track a patch. The suffix needs no
source change and is upgrade-safe; the custom-model rows are DB state, so a
9router upgrade or DB reset drops them (four `kv` inserts to restore, and they
are captured in `config-export.json`).

## The anthropic-compatible node omits `[DONE]` — fixed in source, needs a rebuild

`STREAM_CLOSED` / "SSE stream ended without [DONE]" has a **second, unrelated
cause** beyond the tool-history rejection above, and it is a genuine 9router bug.

Reproduced 6/6: a streaming request through an `anthropic-compatible` node ends
with a `finish_reason` chunk and then **closes without the `data: [DONE]` sentinel**.
dsh's `parseSse` requires the sentinel and throws on EOF:

```
throw new LlmError("SSE stream ended without [DONE]", "STREAM_CLOSED")
```

The same request through an openai-compatible node *does* get `[DONE]`.

Cause: `open-sse/utils/stream.js` emits the sentinel only in the PASSTHROUGH flush
and in the Responses-passthrough branch. The **translation-mode flush emits no
sentinel at all**, and `claude-to-openai.js` only maps `message_stop` to a
finish_reason chunk. The upstream is not at fault — the native API terminates
correctly with `event: message_stop`.

Fix (patch: `9router/backups/local-commits/0001-fix-emit-DONE-sentinel-for-translated-streams.patch`):
emit the sentinel in the translation flush too, reusing the existing
`streamDoneSent` and the same Gemini-family exclusion the passthrough path uses.

**Known blast radius** — this affects *any* translated streaming route, not just
Claude: `openai→claude`, `openai→antigravity/gemini`, `qwen→openai`, the `kiro`
executor, etc. The openai-compatible nodes are unaffected because they take the
PASSTHROUGH path, which is why every non-Claude model worked.

**The fix is in `open-sse/`, which the Next build bundles into
`.next/standalone`.** Editing the source alone does nothing — it needs
`npm run build` plus a service restart, and restarting this gateway kills the
agent session that would be performing it. Rebuild from a fresh session (or the
scripted updater), not from inside a request this gateway is serving.
