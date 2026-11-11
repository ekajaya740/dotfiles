# dsh-auto-archive

Host-side scheduler that archives idle DeepSeek Harness sessions automatically.

## Why this exists

`@michengai/dsh-archive-manager` offers *idle cleanup* as a manual
preview-and-confirm action in the Web UI. Its README is explicit: "There is no
scheduled or automatic background cleanup." Nothing in DSH core schedules
archiving either — `dsh-workspace` exposes `archiveSession()` but no clock, and
OS-level `cron`/`systemd` timers are unavailable in the sandboxed host (PID 1 is
`bwrap`; `crontab` and `systemctl --user` both fail). This plugin supplies the
missing clock inside the host process.

## Behaviour

Every tick the plugin:

1. lists every stored session via `sessionPersistence.list()`;
2. skips archived, pinned, and archive-manager favourite sessions;
3. computes last activity as `max(header.createdAt, log mtime, cached
   lastPromptAt)` — the log mtime is decoded from the persistence revision token
   `dev:ino:size:mtimeNs:ctimeNs`, so an assistant turn that appended to the log
   counts as activity even though it does not change `lastPromptAt`;
4. keeps the sessions idle longer than `idleDays`, oldest first, up to
   `maxPerRun`;
5. calls `workspaceRegistry.archiveSession(id)`.

`archiveSession` is called **without** `stopActivity`, so DSH itself refuses any
session with a live activity provider (running turn, job, scheduled reminder,
in-flight subagent) by throwing `WorkspaceActiveSessionError`. Those sessions are
recorded as `refused` and left untouched — the plugin never kills work.

Archival drops a session's pin in the same durable write, which is why pinned
sessions are skipped rather than archived.

## Config

| key | default | meaning |
| --- | --- | --- |
| `enabled` | `true` | turn the scheduler off without unloading the plugin |
| `cron` | unset | five-field cron in host-local time, e.g. `"0 4 * * *"` |
| `timeZone` | host zone | IANA zone the cron is written against, e.g. `Asia/Makassar` |
| `intervalMinutes` | `60` | used only when `cron` is unset |
| `idleDays` | `30` | archive sessions idle at least this many days (1–36500) |
| `dryRun` | `false` | log candidates without archiving them |
| `maxPerRun` | `50` | cap on archives per sweep |
| `stopActivity` | `false` | pass `stopActivity: true` (force-stops activity — leave off) |
| `logPath` | `$DSH_HOME/auto-archive.log` | JSON-lines run log, one entry per sweep |

Cron follows Vixie semantics: when both day-of-month and day-of-week are
restricted, either may match. `0` and `7` both mean Sunday. Steps (`*/15`),
ranges (`1-5`), and lists (`1,15`) are supported.

**Always set `timeZone`.** The web host runs with `/etc/localtime` at `Etc/UTC`
and no `TZ`, so without it a cron expression silently means UTC — `"0 4 * * *"`
would fire at 12:00 in Asia/Makassar, not 04:00. The default is `null`, meaning
"whatever the host process uses"; name a zone explicitly unless UTC is intended.

Example patch row:

```yaml
- id: dsh-auto-archive
  name: dsh-auto-archive
  config:
    cron: "0 4 * * *"
    timeZone: Asia/Makassar
    idleDays: 45
```

## Manual trigger

The plugin provides an `autoArchive` service:

```js
const auto = ctx.get('autoArchive')
await auto.sweep('manual')   // returns nothing; see status()
auto.status()                // { config, lastRun, lastError, logPath }
```

## Verification

```sh
node test/smoke.mjs
```

The smoke test drives `selectCandidates`/`runSweep` against a fake context that
covers archived, pinned, favourite, active, recently-touched, and
unparseable-revision sessions.

`test/cronclock.mjs` proves the timer half: it mounts the real
`TimerService` from the dsh install tree, uses `cron: "* * * * *"`, and asserts a
sweep fires on the next minute boundary. Run it with
`node /home/personal/dsh-auto-archive/test/cronclock.mjs` — it resolves cordis by
absolute path, so the working directory does not matter.

## Install / schedule changes

Installed into the `web` profile as a link dependency:

- `/home/personal/.dsh/profiles/web/package.json` → `"dsh-auto-archive": "link:/home/personal/dsh-auto-archive"`
- `/home/personal/.dsh/profiles/web/cordis.patch.yml` → the `- insert:` row with the live config

Editing `cron`/`idleDays` in that row does **not** re-arm the running host: the
patch layer is re-read for config, but the already-mounted plugin keeps its
original options and timer. Restart the host (quit and relaunch the Web GUI) to
apply a new schedule. A restart also runs one `startup` sweep immediately, which
is the sweep recorded in `$DSH_HOME/auto-archive.log`.
