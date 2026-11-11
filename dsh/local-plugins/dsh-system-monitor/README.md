# dsh-system-monitor

Live system monitor for the DSH Web GUI: CPU, memory, disks, network and
process metrics as a sidebar panel.

Local plugin for the `web` profile. Installed as a link:

```sh
dsh plugin --profile web add link:/home/personal/dsh-system-monitor
```

## What it adds

1. **System panel.** Sidebar entry (`System`) plus a `main` panel page with
   cards for CPU (total, per core, load average, sparkline), memory (used /
   available / cached / swap), storage, network and the top CPU and memory
   processes.
2. **Sidebar icon.** An inline SVG gauge that fills the icon box the sidebar
   owner sizes (`SidebarPanelIconOwnerProps.size`), inherits the row colour so
   it follows light and dark themes, and marks the selected state via
   `data-active`.
3. **Polling.** 1 s / 2 s / 5 s / 10 s interval buttons and a pause toggle.
   Polling skips ticks while the tab is hidden.
4. **Host route.** `/dsh-system-monitor/snapshot`, same-origin and
   cookie-authenticated through `ctx.connection.requestRejection`.

## Data source

Everything is read from procfs and `node:os`; nothing shells out and no user
file is opened:

| Metric | Source |
| --- | --- |
| CPU total / per core | `/proc/stat` jiffy deltas |
| Load average | `os.loadavg()` |
| Memory / swap | `/proc/meminfo` |
| Storage space / inodes | `/proc/self/mounts` + `fs.statfs` (`blocks/bfree/bavail` and `files/ffree`), pseudo filesystems and bind mounts collapsed |
| Disk throughput / busy | `/proc/diskstats` sector counters and accumulated `io_ticks`, per mount, delta against the previous sample |
| Network | `/proc/net/dev` counters, loopback excluded; the client derives rates from consecutive samples |
| Temperature | hottest `/sys/class/thermal/thermal_zone*/temp`, `null` when absent |
| Processes | `/proc/<pid>/stat` (utime + stime for CPU, rss for memory) |

CPU and per-process figures are deltas between consecutive calls, so the host
keeps the previous sample. A call with no usable prior sample (first call, or
a gap over 30 s) takes a short blocking sample (~120 ms) so the first payload
is still meaningful.

## Storage card

One cell per mounted filesystem: a usage bar, used / total / available, inode
share, and read / write throughput for the device backing that mount. The
totals row sums space and inodes across mounts and reports the aggregate
throughput plus a busy share (device-seconds of IO per elapsed second).

The device behind a mount is resolved from the mount source: the partition's
own `/proc/diskstats` row when the kernel reports one, otherwise its parent
disk, so LVM, device-mapper and whole-disk mounts still get numbers. Loop,
ram and optical devices are ignored, and a mount whose device is unknown
(drives NVMe-style names, network filesystems, tmpfs) shows `—` for
throughput instead of a fabricated zero.

## Layout

- `lib/index.js` — host half: the snapshot route and every metric reader.
- `lib/client.js` — client half: the panel page, sparklines and sidebar entry.
- `cordis.patch.yml` — bundle patch that inserts the plugin.
- `test/route.test.mjs`, `test/io.test.mjs` — host assertions (`npm test`).
  `io.test.mjs` writes ~288 MiB and asserts the reported write rate moves,
  because a wrong device key silently reports 0 B/s.
- `scripts/probe-monitor.mjs`, `scripts/probe-layout.mjs` — raw-CDP probes
  run against a live server (screenshot and layout/pause assertions).
- `scripts/probe-storage.mjs` — storage card: one cell per mount, inode and
  throughput columns, no clipped text, full-width span.
- `scripts/probe-icon.mjs`, `scripts/probe-icon-pixels.mjs`,
  `scripts/probe-theme.mjs` — icon geometry, rasterized coverage and
  light/dark contrast.

## Verifying

```sh
node test/route.test.mjs                                  # host half, no server
dsh --profile web --no-open --port 3102                   # token printed on stdout
node scripts/probe-layout.mjs http://127.0.0.1:3102 <token>
```

`probe-icon.mjs` asserts the glyph fits the owner's box with no overflow and
stays inside its viewBox, `probe-icon-pixels.mjs` rasterizes the SVG and
counts painted pixels (so a blank icon cannot pass), and `probe-theme.mjs`
checks the stroke against the resolved sidebar background in both schemes.

The probes drive the bundled Chrome over CDP (no playwright/puppeteer is
installed). `probe-layout.mjs` clicks the sidebar entry and asserts the card
set, per-core rows, memory rows, absence of `NaN`/`undefined` text, no
document x-overflow, and that pause freezes the figures and sparkline.
