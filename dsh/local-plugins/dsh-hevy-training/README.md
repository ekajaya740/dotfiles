# dsh-hevy-training

A **Training** page for the [DeepSeek Harness](https://github.com/deepseek-ai/dsh) Web GUI, backed by the
[Hevy](https://hevy.com) public API.

It answers the questions that actually drive a program: *how much did I lift, is my training spread evenly
across muscle groups, which lifts are progressing, and what is my body weight doing.*

The host half holds the API key and does all the network and aggregation work, so the page opens and refreshes
without running an agent turn, and the credential never reaches the browser.

## What you get

A `Training` entry in the sidebar opens a full-page panel with five tabs:

| Tab | Content |
| --- | --- |
| Overview | This-week cards (sessions, volume, sets, minutes, week streak), a 12-week volume/sessions chart, session quality, and any PRs from the last 30 days |
| Muscles | Working-set credit per muscle group over a 28-day window (primary lift = 1 set, secondary = 0.5), plus a warning for groups untouched for more than 14 days |
| Lifts | The 12 most-trained exercises ranked by estimated 1RM, each with an e1RM history and the previous best |
| Weight | Body-weight series from `body_measurements`, with the latest value, the delta from the previous reading, and a staleness warning past 7 days |
| Sessions | The 12 most recent workouts, free-text session notes; click one for per-exercise, per-set detail (weight, reps, RPE, duration, distance) |

Two sections exist because training is not only a load question:

- **Session quality** measures the three things a tonnage number cannot see — how far the *last* set of an
  exercise falls below its *best* set in the same session (a collapse past 25% is flagged), how many sets were
  taken to failure, and what share of working sets carry an RPE. This is what makes "end the exercise when reps
  collapse" and "six weeks without failure, then RPE 7 → 8" checkable instead of remembered.
- **Session notes** (Sessions tab) surfaces `workout.description` and per-exercise notes, newest first. Notes are
  the only place the *why* of a session lives, and they were previously reachable only by opening each session
  individually. A session's own description is also shown at the top of its drill-down.

Charts are inline SVG built from the payload — no chart dependency, no canvas, and every colour comes from the
`--dsw-alias-*` theme tokens so the panel is legible in both light and dark.

## Install

```bash
dsh plugin --profile web add link:/path/to/dsh-hevy-training
```

Then give the host process a Hevy API key (Hevy app → Settings → Developer → create an API key). The key is read
from `HEVY_API_KEY`:

```bash
# ~/.config/dsh/env — sourced by the systemd unit via EnvironmentFile
HEVY_API_KEY=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

Restart DSH after changing the environment — the host reads the key per request, but the plugin module itself is
imported once at boot.

If your key lives somewhere the host cannot see, set it in the profile patch instead
(`~/.dsh/profiles/web/cordis.patch.yml`):

```yaml
- id: dsh-hevy-training
  name: dsh-hevy-training
  config:
    apiKey: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

## Config

All keys are optional; the defaults are the values above.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | When false the data routes answer `503` |
| `apiKey` | string | `null` | Overrides `HEVY_API_KEY` |
| `baseUrl` | string | `https://api.hevyapp.com` | API origin |
| `timeZone` | string | host zone | IANA zone used for calendar bucketing (`Asia/Makassar`), not UTC |
| `weeks` | integer 1–52 | `12` | Length of the weekly series |
| `muscleWindowDays` | integer 7–365 | `28` | Look-back for the muscle-balance window |
| `qualityWindowDays` | integer 7–365 | `42` | Look-back for session quality — six weeks, so the journal's "no failure for six weeks" rule is readable |
| `snapshotHistoryDays` | integer 0–365 | `120` | Daily snapshots kept for week-over-week diffs; `0` disables pruning |
| `historyDir` | string | `$DSH_HOME/hevy-training-snapshots` | Where snapshot documents are stored |
| `cacheSeconds` | integer 0–3600 | `300` | How long one aggregated payload stays warm |

`timeZone` matters: Hevy stores `start_time` in UTC, so a 06:00 workout in Makassar belongs to the previous UTC
day. Bucketing by UTC alone would file it under the wrong week.

## Routes

The panel reads three same-origin `GET` routes under `/dsh-hevy-training`; two more exist for automated review
rather than for the UI:

| Route | Returns |
| --- | --- |
| `/overview?weeks=12&muscleWindowDays=28&qualityWindowDays=42` | Everything the panel renders in one payload — including `quality`, `notes`, and `weightFreshness` |
| `/session?id=<workout-id>` | One workout with full set detail |
| `/status` | Whether the key resolved, from where, and the effective config |
| `/snapshot?store=0` | The review document below, plus `diff` against the previous stored day. `store=0` skips reading and writing history |
| `/digest.md` | The same facts as a markdown brief. Never writes history |

### The snapshot document

`/snapshot` answers a different question from `/overview`: not "what does the panel draw" but "what changed, and
does a week-over-week diff line up". It is therefore stable, versioned and flat where it matters:

- `schemaVersion` (currently `1`) — `diffSnapshots` refuses to compare across versions and says so in `diff.reason`
  instead of returning a misleading zero.
- `week` / `previousWeek` — flat scalars (`sessions`, `volumeKg`, `sets`, `reps`, `minutes`), so a diff is subtraction
  rather than list surgery.
- `muscles` — **every** group in `MUSCLE_ORDER` on every run, including ones with zero sets, so a diff never has to
  distinguish "0 sets" from "group missing".
- `lifts` — sorted by `templateId` for the same reason.
- `flags` — a fixed vocabulary, sorted and deduplicated, that names what a review must not miss:
  `week:empty`, `streak:broken`, `weight:none`, `weight:stale`, `quality:collapse`, `quality:rpe-thin`,
  `progression:failure-free`, `muscle-stale:<group>`.
- No set-level detail. Notes and PRs are included as lists so a diff can report what is new.

`diffSnapshots` returns `changes` (metric, before, after, delta, deltaPct) for the scalars and per-group set counts,
plus `flagsAdded`, `flagsCleared`, `newPrs`, `newNotes` and `daysBetween`.

Two notes on the flags:

- `progression:failure-free` needs working sets inside the window. An athlete who has logged nothing is not
  "progressing without failure", and `week:empty` already says the useful thing.
- `muscle-stale:<group>` means trained-then-lapsed, not never-trained. A group absent from the program carries no
  signal; `lastTrained: null` on the muscle row already says so.
- `streak:broken` needs a streak to have existed. A new athlete has broken nothing, and `week:empty` already says
  the useful thing.

### History

`/snapshot` writes one document per calendar day (`asOf`), atomically, and keeps the newest
`snapshotHistoryDays`. The directory is a local cache of documents the host just computed — not a training record —
and deleting it only costs the next diff. `/digest.md` never writes, so fetching it twice cannot move the baseline.


## Read-only by design

Hevy has no delete and no undo on any object, and `POST /v1/workouts` / `POST /v1/routines` are not idempotent —
a replayed write would silently duplicate a real training session. Version 0.1 therefore issues `GET` only. Writes
are a separate design problem (they need an idempotency key and an explicit confirm step), not a missing flag.

## Development

```bash
npm test        # node --test, pure aggregation tests, no network
```

`lib/client.js` is a hand-written bundle in the shell's `ModuleLoader` wrapper: the profile ships no React or
TypeScript toolchain and the shell seeds `react`/`react-dom` as static modules, so there is no build step. Its
`__parts` export lets a harness render the components directly.

```
lib/aggregate.js   pure functions over Hevy documents — no I/O, no clock of its own
lib/history.js     daily snapshot documents on disk, atomic writes, retention
lib/hevy.js        minimal GET-only Hevy client with timeouts and typed errors
lib/index.js       host half: config, routes, caching, credential
lib/client.js      client half: the Training panel
test/              aggregation tests over fixtures captured from the live API
```

## License

MIT
