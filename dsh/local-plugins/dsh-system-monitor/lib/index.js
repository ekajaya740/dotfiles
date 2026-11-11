/**
 * dsh-system-monitor — host half.
 *
 * One read-only route under `/dsh-system-monitor`:
 *   GET /dsh-system-monitor/snapshot → CPU / memory / swap / load / storage / net / process metrics
 *
 * Same-origin browser route guarded by `ctx.connection.requestRejection`.
 * Every metric is read from the kernel's own procfs and `fs.statfs`; the plugin
 * never shells out and never touches user files.
 *
 * CPU and per-process figures are deltas, so the module keeps the previous
 * sample and reports usage since then. A first call with no prior sample takes
 * a short blocking sample (~120 ms) so the very first payload is meaningful.
 *
 * @module dsh-system-monitor
 */
import { readFile, readdir, statfs } from 'node:fs/promises'
import { arch, cpus, hostname, loadavg, platform, release, uptime } from 'node:os'

/** Plugin name shown in the loader/plugin manager. */
export const name = 'dsh-system-monitor'

/** Host services this half needs. */
export const inject = ['webServer']

/** Route prefix owned by this plugin. */
const PREFIX = '/dsh-system-monitor'

/** Pseudo filesystems never reported as disks. */
const SKIP_FS = new Set([
  'proc', 'sysfs', 'devtmpfs', 'devpts', 'tmpfs', 'cgroup', 'cgroup2', 'pstore', 'bpf',
  'tracefs', 'debugfs', 'securityfs', 'configfs', 'fusectl', 'mqueue', 'hugetlbfs',
  'autofs', 'binfmt_misc', 'nsfs', 'squashfs', 'ramfs', 'rpc_pipefs', 'efivarfs',
  'overlay', 'fuse.gvfsd-fuse', 'fuse.portal', 'fuse.lxcfs',
])

/** Mount points never reported (already covered by a real root mount). */
const SKIP_MOUNT = /^\/(snap|var\/snap|sys|proc|dev|run)(\/|$)/

/** Processes listed per table. */
const TOP_N = 5

/** A gap this long between samples makes stored deltas meaningless. */
const STALE_AFTER_MS = 30_000

/**
 * Previous sample, so the next call can report usage since it.
 * @type {{at: number, cpu: number[], procs: Map<number, {ticks: number, name: string}>, io: Map<string, {read: number, write: number, ioMs: number}>} | null}
 */
let previous = null

/** Host facts that never change while the process lives. */
const STATIC = {
  hostname: hostname(),
  platform: platform(),
  release: release(),
  arch: arch(),
  cores: cpus().length,
}

/**
 * Write one JSON response.
 * @param {import('node:http').ServerResponse} res - response.
 * @param {number} status - HTTP status code.
 * @param {unknown} body - JSON-safe body.
 * @returns {void}
 */
function json(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': String(Buffer.byteLength(text)),
  })
  res.end(text)
}

/**
 * Reject a request that is not a same-origin GET.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {import('node:http').IncomingMessage} req - request.
 * @param {import('node:http').ServerResponse} res - response.
 * @returns {boolean} whether the handler should continue.
 */
function guard(ctx, req, res) {
  const connection = ctx.get('connection')
  if (connection !== undefined && connection.requestRejection(req) !== undefined) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('forbidden')
    return false
  }
  if (!['GET', 'HEAD'].includes(req.method ?? 'GET')) {
    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('method not allowed')
    return false
  }
  return true
}

/**
 * Read `/proc/stat`'s aggregate and per-core jiffy counters.
 * @returns {Promise<number[]>} `[total, idle, ...]` followed by each core's `[total, idle]` pairs flattened.
 */
async function readCpuTicks() {
  const text = await readFile('/proc/stat', 'utf8')
  /** @type {number[]} */
  const ticks = []
  for (const line of text.split('\n')) {
    if (!line.startsWith('cpu')) continue
    const parts = line.trim().split(/\s+/)
    const values = parts.slice(1).map(Number)
    if (values.some((value) => !Number.isFinite(value))) continue
    // user nice system idle iowait irq softirq steal — idle time counts idle+iowait.
    const total = values.slice(0, 8).reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0)
    const idle = (values[3] ?? 0) + (values[4] ?? 0)
    ticks.push(total, idle)
  }
  return ticks
}

/**
 * Turn two tick samples into busy fractions.
 * @param {number[]} before - earlier sample (may be empty).
 * @param {number[]} after - later sample.
 * @returns {{usage: number, perCore: number[]}} aggregate and per-core busy fractions in `[0, 1]`.
 */
function cpuUsage(before, after) {
  /** @param {number} index - pair index in the flattened array. */
  const pair = (index) => {
    const totalNow = after[index * 2]
    const idleNow = after[index * 2 + 1]
    const totalThen = before[index * 2]
    const idleThen = before[index * 2 + 1]
    if (totalNow === undefined) return 0
    if (totalThen === undefined) return 0
    const total = totalNow - totalThen
    const idle = idleNow - idleThen
    if (total <= 0) return 0
    return Math.min(1, Math.max(0, (total - idle) / total))
  }
  const pairs = Math.floor(after.length / 2)
  const perCore = []
  for (let index = 1; index < pairs; index += 1) perCore.push(pair(index))
  return { usage: pair(0), perCore }
}

/**
 * Parse `/proc/meminfo` into bytes.
 * @returns {Promise<Record<string, number>>} key → bytes.
 */
async function readMeminfo() {
  const text = await readFile('/proc/meminfo', 'utf8')
  /** @type {Record<string, number>} */
  const info = {}
  for (const line of text.split('\n')) {
    const match = /^(\w+):\s+(\d+)/.exec(line)
    if (match === null) continue
    info[match[1]] = Number(match[2]) * 1024
  }
  return info
}

/**
 * Read one process's CPU ticks and resident bytes.
 * @param {number} pid - process id.
 * @returns {Promise<{ticks: number, rss: number, name: string} | null>} null when the process vanished.
 */
async function readProcess(pid) {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8')
    const close = stat.lastIndexOf(')')
    if (close < 0) return null
    const name = stat.slice(stat.indexOf('(') + 1, close)
    const fields = stat.slice(close + 2).split(' ')
    // After the command: state(0) … utime is field 14, stime 15, rss 24.
    const utime = Number(fields[11])
    const stime = Number(fields[12])
    const rssPages = Number(fields[21])
    if (!Number.isFinite(utime) || !Number.isFinite(stime)) return null
    return { ticks: utime + stime, rss: Number.isFinite(rssPages) ? rssPages * 4096 : 0, name }
  } catch {
    return null
  }
}

/**
 * Sample every live process.
 * @returns {Promise<Map<number, {ticks: number, rss: number, name: string}>>} pid → sample.
 */
async function readProcesses() {
  /** @type {Map<number, {ticks: number, rss: number, name: string}>} */
  const found = new Map()
  let entries
  try {
    entries = await readdir('/proc')
  } catch {
    return found
  }
  const pids = entries.filter((entry) => /^\d+$/.test(entry)).map(Number)
  const samples = await Promise.all(pids.map((pid) => readProcess(pid)))
  samples.forEach((sample, index) => {
    if (sample !== null) found.set(pids[index], sample)
  })
  return found
}

/**
 * Physical mounts with their space and inode use.
 * @returns {Promise<Array<{mount: string, device: string, fs: string, size: number, used: number, available: number, usage: number, inodesTotal: number, inodesUsed: number, inodesUsage: number}>>} storage table.
 */
async function readMounts() {
  /** @type {Array<{mount: string, device: string, fs: string, size: number, used: number, available: number, usage: number, inodesTotal: number, inodesUsed: number, inodesUsage: number}>} */
  const disks = []
  /** @type {Set<string>} */
  const seen = new Set()
  /** @type {Set<string>} */
  const seenDevice = new Set()
  let text
  try {
    text = await readFile('/proc/self/mounts', 'utf8')
  } catch {
    return disks
  }
  for (const line of text.split('\n')) {
    const parts = line.split(' ')
    if (parts.length < 3) continue
    const [device, rawMount, fs] = parts
    if (SKIP_FS.has(fs)) continue
    if (device.startsWith('/dev/loop') || device === 'none' || device === '') continue
    if (SKIP_MOUNT.test(rawMount)) continue
    const mount = rawMount.replace(/\\040/g, ' ')
    if (seen.has(mount)) continue
    seen.add(mount)
    // Bind mounts of one filesystem share a device: list such a filesystem once.
    if (seenDevice.has(device)) continue
    seenDevice.add(device)
    try {
      const info = await statfs(mount)
      const size = info.blocks * info.bsize
      const available = info.bavail * info.bsize
      const used = size - info.bfree * info.bsize
      const inodesTotal = Number(info.files) || 0
      const inodesUsed = inodesTotal - (Number(info.ffree) || 0)
      disks.push({
        mount,
        device,
        fs,
        size,
        used,
        available,
        usage: size > 0 ? used / size : 0,
        inodesTotal,
        inodesUsed,
        inodesUsage: inodesTotal > 0 ? inodesUsed / inodesTotal : 0,
      })
    } catch {
      // mount not statable from this container: skip
    }
  }
  disks.sort((left, right) => right.size - left.size)
  return disks
}

/**
 * Read `/proc/diskstats` byte counters and accumulated service time per device.
 * @returns {Promise<Map<string, {read: number, write: number, ioMs: number}>>} kernel device name → counters.
 */
async function readDiskStats() {
  /** @type {Map<string, {read: number, write: number, ioMs: number}>} */
  const stats = new Map()
  let text
  try {
    text = await readFile('/proc/diskstats', 'utf8')
  } catch {
    return stats
  }
  // A sector is 512 bytes regardless of the device's logical block size.
  const SECTOR = 512
  for (const line of text.split('\n')) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 14) continue
    const device = parts[2]
    if (device === '' || device.startsWith('loop') || device.startsWith('ram') || device.startsWith('sr')) continue
    const sectorsRead = Number(parts[5])
    const sectorsWritten = Number(parts[9])
    const ioMs = Number(parts[12])
    if (!Number.isFinite(sectorsRead) || !Number.isFinite(sectorsWritten)) continue
    stats.set(device, {
      read: sectorsRead * SECTOR,
      write: sectorsWritten * SECTOR,
      ioMs: Number.isFinite(ioMs) ? ioMs : 0,
    })
  }
  return stats
}

/**
 * Kernel device name backing one mount, e.g. `/dev/sda1` → `sda1`.
 * @param {string} device - device path from `/proc/self/mounts`.
 * @returns {string} bare device name, or an empty string for non-device mounts.
 */
function deviceName(device) {
  if (!device.startsWith('/dev/')) return ''
  return device.slice('/dev/'.length).replace(/\/mapper\//, '')
}

/**
 * Counters for one mount: its own partition row when the kernel reports one,
 * otherwise its parent disk (LVM, dm and whole-disk mounts).
 * @param {string} mountDevice - bare device name for the mount.
 * @param {Map<string, {read: number, write: number, ioMs: number}>} stats - disk counters.
 * @returns {{read: number, write: number, ioMs: number} | null} counters, or null when unknown.
 */
function ioFor(mountDevice, stats) {
  if (mountDevice === '') return null
  const direct = stats.get(mountDevice)
  if (direct !== undefined) return direct
  const parent = mountDevice.replace(/\d+$/, '')
  return parent === mountDevice ? null : stats.get(parent) ?? null
}

/**
 * Per-interface traffic counters.
 * @returns {Promise<Array<{iface: string, rx: number, tx: number}>>} interface table, loopback excluded.
 */
async function readNet() {
  /** @type {Array<{iface: string, rx: number, tx: number}>} */
  const net = []
  let text
  try {
    text = await readFile('/proc/net/dev', 'utf8')
  } catch {
    return net
  }
  for (const line of text.split('\n')) {
    const match = /^\s*([^:]+):\s*(.+)$/.exec(line)
    if (match === null) continue
    const iface = match[1].trim()
    if (iface === 'lo' || iface === '') continue
    const values = match[2].trim().split(/\s+/).map(Number)
    net.push({ iface, rx: values[0] ?? 0, tx: values[8] ?? 0 })
  }
  return net
}

/**
 * Hottest readable thermal zone, when the host exposes one.
 * @returns {Promise<number | null>} degrees Celsius, or null when unavailable.
 */
async function readTemperature() {
  try {
    const zones = await readdir('/sys/class/thermal')
    for (const zone of zones) {
      if (!zone.startsWith('thermal_zone')) continue
      const raw = await readFile(`/sys/class/thermal/${zone}/temp`, 'utf8')
      const milli = Number(raw.trim())
      if (Number.isFinite(milli) && milli > 0) return milli / 1000
    }
  } catch {
    // no thermal class on this host
  }
  return null
}

/**
 * Build one full snapshot, refreshing the stored sample.
 * @returns {Promise<object>} snapshot body.
 */
async function snapshot() {
  const now = Date.now()
  const ticks = await readCpuTicks()
  const prior = previous !== null && now - previous.at < STALE_AFTER_MS ? previous : null
  if (prior === null) {
    await new Promise((done) => setTimeout(done, 120))
  }
  const fresh = prior === null ? await readCpuTicks() : ticks
  const cpu = cpuUsage(prior?.cpu ?? ticks, fresh)
  const [one, five, fifteen] = loadavg()
  const mem = await readMeminfo()
  const procs = await readProcesses()
  const ioStats = await readDiskStats()
  const elapsedMs = prior === null ? 120 : Math.max(1, now - prior.at)
  const cores = Math.max(1, STATIC.cores)

  /** @type {Array<{pid: number, name: string, cpu: number, rss: number}>} */
  const ranked = []
  for (const [pid, sample] of procs) {
    const before = prior?.procs.get(pid)
    const delta = before === undefined ? 0 : Math.max(0, sample.ticks - before.ticks)
    // Jiffies are 10 ms: busy CPU seconds over wall time, normalized per core.
    ranked.push({
      pid,
      name: sample.name,
      cpu: delta * 10 / elapsedMs / cores,
      rss: sample.rss,
    })
  }

  // Storage: one row per filesystem, plus the totals and the busiest device's
  // throughput since the previous sample.
  const elapsedSeconds = Math.max(0.05, (prior === null ? 120 : Math.max(1, now - prior.at)) / 1000)
  const mounts = await readMounts()
  /** @type {Record<string, {read: number, write: number, io: number, readTotal: number, writeTotal: number}>} */
  const ioRates = {}
  for (const disk of mounts) {
    const counters = ioFor(deviceName(disk.device), ioStats)
    if (counters === null) continue
    const before = prior?.io.get(deviceName(disk.device))
    ioRates[disk.mount] = {
      read: before === undefined ? 0 : Math.max(0, counters.read - before.read) / elapsedSeconds,
      write: before === undefined ? 0 : Math.max(0, counters.write - before.write) / elapsedSeconds,
      io: before === undefined ? 0 : Math.max(0, counters.ioMs - before.ioMs) / 1000 / elapsedSeconds,
      readTotal: counters.read,
      writeTotal: counters.write,
    }
  }
  let storageTotal = 0
  let storageUsed = 0
  let storageAvailable = 0
  let inodesTotal = 0
  let inodesUsed = 0
  for (const disk of mounts) {
    storageTotal += disk.size
    storageUsed += disk.used
    storageAvailable += disk.available
    inodesTotal += disk.inodesTotal
    inodesUsed += disk.inodesUsed
  }

  const totalMem = mem.MemTotal ?? 0
  const available = mem.MemAvailable ?? mem.MemFree ?? 0
  const swapTotal = mem.SwapTotal ?? 0
  const swapFree = mem.SwapFree ?? 0

  /** @type {{at: number, cpu: number[], procs: Map<number, {ticks: number, name: string}>}} */
  const stored = { at: now, cpu: fresh, procs: new Map(), io: new Map() }
  for (const [pid, sample] of procs) stored.procs.set(pid, { ticks: sample.ticks, name: sample.name })
  for (const [device, counters] of ioStats) stored.io.set(device, counters)
  previous = stored

  return {
    time: now,
    host: { ...STATIC, uptime: uptime() },
    cpu: {
      usage: cpu.usage,
      perCore: cpu.perCore,
      load: [one, five, fifteen],
      sampleMs: elapsedMs,
    },
    memory: {
      total: totalMem,
      used: Math.max(0, totalMem - available),
      available,
      free: mem.MemFree ?? 0,
      cached: mem.Cached ?? 0,
      buffers: mem.Buffers ?? 0,
      swapTotal,
      swapUsed: Math.max(0, swapTotal - swapFree),
    },
    storage: {
      mounts: mounts.map((disk) => ({
        ...disk,
        io: ioRates[disk.mount] ?? null,
      })),
      total: storageTotal,
      used: storageUsed,
      available: storageAvailable,
      usage: storageTotal > 0 ? storageUsed / storageTotal : 0,
      inodesTotal,
      inodesUsed,
      inodesUsage: inodesTotal > 0 ? inodesUsed / inodesTotal : 0,
      read: Object.values(ioRates).reduce((sum, entry) => sum + entry.read, 0),
      write: Object.values(ioRates).reduce((sum, entry) => sum + entry.write, 0),
      busy: Math.min(1, Object.values(ioRates).reduce((sum, entry) => sum + entry.io, 0)),
    },
    net: await readNet(),
    temperature: await readTemperature(),
    processes: {
      total: procs.size,
      topCpu: ranked.slice().sort((left, right) => right.cpu - left.cpu).slice(0, TOP_N),
      topMem: ranked.slice().sort((left, right) => right.rss - left.rss).slice(0, TOP_N),
    },
  }
}

/**
 * Register the snapshot route.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @returns {void}
 */
export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: `${PREFIX}/snapshot`,
    handler: async (req, res) => {
      if (!guard(ctx, req, res)) return
      try {
        const value = await snapshot()
        if (req.method === 'HEAD') {
          json(res, 200, { ok: true })
          return
        }
        json(res, 200, { ok: true, value })
      } catch (error) {
        if (res.headersSent) {
          res.destroy()
          return
        }
        json(res, 500, { ok: false, error: String(error?.message ?? error) })
      }
    },
  }), 'dsh-system-monitor: /dsh-system-monitor/snapshot route')
}
