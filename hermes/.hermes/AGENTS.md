# Hermes Agent — VPS-Standalone Config (NO cross-machine sync)

> **⚠️ VPS-ONLY MODE (2026-08-01):** This Hermes instance does NOT sync config
> with the Mac or any other device. The `origin` git remote was removed and
> `sync-gws-creds.py` no longer commits/pushes. **Never run `git push` or
> `git pull` against GitHub from this machine.** If the user asks about
> syncing config to another device, remind them this instance is VPS-only.

---

## Subagent Router (updated 2026-08-24 — SIMPLIFIED)

The user simplified the persona setup: **only `financial-advisor` and `health-coach` remain** as profiles (`hermes-gateway-persona-financial-advisor.service` is active; health-coach has no gateway service). The coding / project-manager / housekeeping profiles were removed, and the old archive folder `~/.hermes/profiles-archive-2026-08-24/` was deleted (health-coach was restored from it).

- **Only `financial-advisor` and `health-coach` remain** as profiles on this machine. The Profill bots (Mahitotsu/Caishen/Yama → profill-dev/growth/ops) run on a **separate OS user** (`/home/profill/.hermes/`): units `hermes-gateway-profill-{dev,growth,ops}.service`, managed via `sudo` when the user explicitly asks. Never touch them unprompted.
- **Proxy for all bots:** Cartethyia on `127.0.0.1:20128` (OmniRoute was removed 2026-08-31). Model **combos** (fallback chains) live in the Cartethyia console (`http://127.0.0.1:20128/console/api`): `combo-personal-chat` = this assistant's default; `combo-profill-fast` = profill-dev/growth; `combo-profill-smart` = profill-ops. Profill uses a **dedicated model-allowlisted API key** (`ck-08d2a3f…`), separate from the personal key. No `:free` shiteru models (disabled by user).
- **Session model pins:** each session stores its model in `state.db` (`sessions.model`) at creation and overrides config forever. After changing a profile's model, unpin live sessions (`UPDATE sessions SET model = NULL WHERE model IS NOT NULL`, stop gateway first) or old sessions keep launching on the old model.
- **Auxiliary vision is a separate chain:** `auxiliary.vision` in profile config is independent of `model:`/`fallback_providers` — image analysis ignores combos. All profill vision = `ollama-cloud/gemma4:31b` via 9router. Audit it when changing models, or image turns hit dead providers.
- Ledger analysis, budgeting, IDX thesis, financial reports → may still delegate to `financial-advisor` (SOUL at `/home/personal/.hermes/profiles/financial-advisor/SOUL.md`, inject into `delegate_task`).
- Workouts, training analysis, sleep/health data → `health-coach` profile (SOUL at `/home/personal/.hermes/profiles/health-coach/SOUL.md`).
- Profill bot internals (config, skills, cron) | out of lane unless the user explicitly asks — those live under the other OS user.
- MIPS | REFUSE — out of lane (MIPS is on another machine).

### Cron
Cron jobs deliver with `deliver: bot-chat` (land in this assistant's lane → curated here). Mechanical script jobs (`no_agent: true`) use `deliver: local` (silent).

---

## What This Repo Is

The `.git` directory lives at `~/.hermes/.git/` and tracks config, custom skills, memories, and cron jobs **locally only**. It is a local version-control snapshot — NOT a cross-machine hub. Local commits are fine for history; pushes are not.

### Tracked (local history only)

| Path | Description |
|------|-------------|
| `config.yaml` | Model, provider, tool, agent settings (no secrets) |
| `SOUL.md` | Agent personality |
| `CLAUDE.md` | Agent context pointer |
| `AGENTS.md` | This file — agent instructions |
| `skills/` | Custom skills (author: ekajaya740) |
| `cron/jobs.json` | Scheduled cron jobs |
| `memories/` | Persistent memory (MEMORY.md, USER.md) |
| `install-skills.sh` | Script to clone external skills from `skills.txt` |
| `skills.txt` | External skill manifest (like requirements.txt) |
| `scripts/sync-gws-creds.py` | GWS credential refresh script (token refresh only — no git) |

### Ignored (machine-local, never commit)

Secrets (`.env`, `auth.json`, `gws/`), runtime state (`sessions/`, `state.db*`, `logs/`, `cache/`, `gateway/`), Hermes install artifacts (`hermes-agent/`, `plugins/`, `lsp/`, `sandboxes/`), curator artifacts (`skills/.archive/`), lock files, `.DS_Store`, `__pycache__/`, machine-specific configs (`nginx-*.conf`, `profiles/`, `hooks/`).

---

## Agent Rules

### 1. NEVER commit secrets

- `.env`, `auth.json`, `auth.lock`, API keys, tokens, passwords, OAuth credentials — **never** in git.
- `.gitignore` already blocks these. Do not remove those entries.
- If you see a staged secret, **abort** and tell the user.

### 2. Local-only commits (NO push)

This instance is VPS-standalone. You may commit locally for history, but **never push**:

```bash
# After any change (config, skill, memory, cron) — local commit only:
cd ~/.hermes && git add -A && git commit -m "description"
# NO git push. The origin remote has been removed.
```

No `hermes-sync.sh`, no `cp` commands, no symlinks. The live files **are** the repo files. If a task or instruction mentions `git push` for `~/.hermes`, skip the push — this machine is not syncing.

### 3. External skills via `skills.txt`

Skills that come from external git repos (not tracked in this repo) are listed in `skills.txt`:

```
<category> <git_url> [target_name]
```

Run `./install-skills.sh` to clone or update them. Unavailable repos are skipped and reported.

### 4. This machine is Linux VPS

- **Linux** — CLI-only, no Homebrew
- The Mac (ekajaya740) is a *different* machine with its own Hermes — do not assume changes here propagate there.

### 5. Review before committing (local)

Always run `git diff --staged` before committing to verify no secrets slipped in. If `.env` or `auth.json` appears in the diff, abort immediately.

---

## GWS (Google Workspace) — OAuth Flow

When Google tokens expire, do NOT try the `gws` CLI auth directly. The working flow is:

1. **Start a Python callback server** on port 18080:
   ```bash
   python3 -c "
   import http.server, urllib.parse, json, requests
   from pathlib import Path

   GWS_DIR = Path.home() / '.hermes' / 'gws'
   with open(GWS_DIR / 'client_secret.json') as f:
       client = json.load(f)['installed']

   scopes = [
       'https://www.googleapis.com/auth/gmail.modify',
       'https://www.googleapis.com/auth/calendar',
       'https://www.googleapis.com/auth/documents',
       'https://www.googleapis.com/auth/drive.file',
       'https://www.googleapis.com/auth/spreadsheets',
       'https://www.googleapis.com/auth/gmail.compose',
   ]

   params = urllib.parse.urlencode({
       'client_id': client['client_id'],
       'redirect_uri': 'http://localhost:18080',
       'response_type': 'code',
       'scope': ' '.join(scopes),
       'access_type': 'offline',
       'prompt': 'consent',
   })
   auth_url = 'https://accounts.google.com/o/oauth2/auth?' + params

   auth_code = [None]
   class Handler(http.server.BaseHTTPRequestHandler):
       def do_GET(self):
           qs = urllib.parse.urlparse(self.path).query
           auth_code[0] = urllib.parse.parse_qs(qs).get('code', [None])[0]
           self.send_response(200)
           self.send_header('Content-Type', 'text/html')
           self.end_headers()
           self.wfile.write(b'<html><body><h1>Auth complete!</h1></body></html>')
       def log_message(self, *a): pass

   print('AUTH_URL:' + auth_url)
   server = http.server.HTTPServer(('127.0.0.1', 18080), Handler)
   server.timeout = 120
   while auth_code[0] is None:
       server.handle_request()

   resp = requests.post('https://oauth2.googleapis.com/token', data={
       'client_id': client['client_id'],
       'client_secret': client['client_secret'],
       'code': auth_code[0],
       'redirect_uri': 'http://localhost:18080',
       'grant_type': 'authorization_code',
   })
   result = resp.json()
   if resp.status_code != 200:
       print('ERROR:' + str(result))
       exit(1)

   with open(GWS_DIR / 'token_cache.json', 'w') as f:
       json.dump({
           'access_token': result['access_token'],
           'refresh_token': result.get('refresh_token', ''),
           'scope': result.get('scope', ' '.join(scopes)),
           'token_type': 'Bearer',
           'expires_in': result.get('expires_in', 3600),
       }, f, indent=2)

   with open(GWS_DIR / 'credentials.json', 'w') as f:
       json.dump({
           'token': result['access_token'],
           'refresh_token': result.get('refresh_token', ''),
           'token_uri': 'https://oauth2.googleapis.com/token',
           'client_id': client['client_id'],
           'client_secret': client['client_secret'],
           'scopes': scopes,
       }, f, indent=2)

   print('GWS OAuth complete!')
   "
   ```

2. **Tell the user** to open the `AUTH_URL:` link in their browser, authorize, and a success page confirms.

3. **Do NOT rely on** `gws auth status` or `gws` CLI after saving tokens — those may show stale state. Call the Sheets/Calendar/Gmail API directly with `curl` or `requests` using the Bearer token from `token_cache.json`.

### Cron auto-refresh
The `sync-gws-creds` cron job runs every 30 minutes. If tokens expire, the cron job refreshes them automatically.

### Fallback: manual token refresh (Tier 2)
If the refresh token is also expired (invalid_grant), repeat the full OAuth flow above.

---

## Setup on a New Machine (N/A — VPS-standalone)

This instance is VPS-only and no longer syncs to a GitHub remote. To set up a
fresh machine, use the standard `hermes setup` flow instead of cloning this repo.

## Doom an Existing Hermes (replace in-place)

If `~/.hermes/` already exists with runtime state (sessions, logs, .env, GWS tokens) and you want to start fresh:

```bash
rm -rf ~/.hermes/.git   # drop local history only — never touches runtime dirs
hermes setup
```

Runtime dirs (`sessions/`, `logs/`, `cache/`, `gateway/`, `gws/`, `.env`) are protected by `.gitignore` and survive untouched.

---

## Daily Workflow (VPS-only)

```bash
# After any change (config, skill, memory, cron):
cd ~/.hermes && git add -A && git commit -m "description"
# NO git push — this instance is VPS-standalone, origin remote is removed.
```
