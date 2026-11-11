/**
 * dsh-auto-archive — host-side scheduled auto-archive of idle sessions.
 *
 * The `@michengai/dsh-archive-manager` plugin ships idle *cleanup* as a manual
 * preview-and-confirm UI action only (its README, "There is no scheduled or
 * automatic background cleanup."). Nothing in DSH core schedules archiving
 * either, so this plugin supplies the missing clock: every `intervalMinutes`
 * it lists stored sessions, picks the ones whose last activity is older than
 * `idleDays`, and archives them through the official workspace registry.
 *
 * Safety rules (a session is never archived when):
 *  - it is already archived,
 *  - it is pinned (pinning and archival are mutually exclusive),
 *  - it is a favourite of the archive manager,
 *  - any activity provider reports it as active — `archiveSession` is called
 *    WITHOUT `stopActivity`, so DSH itself refuses a running turn, job,
 *    scheduled reminder, or in-flight subagent instead of killing it,
 *  - its last-activity time cannot be determined.
 *
 * Last activity is `max(header.createdAt, log mtime)`; the log mtime comes from
 * the persistence revision token (`dev:ino:size:mtimeNs:ctimeNs`), which is
 * refreshed on every durable append. When a projection cache is mounted, the
 * cached `sessionListMetadata.lastPromptAt` is preferred as the activity time,
 * matching what the session list shows.
 *
 * Config (see README): enabled, cron, intervalMinutes, idleDays, dryRun,
 * maxPerRun, stopActivity, logPath. With `cron` set the sweep follows that
 * five-field expression (checked once a minute); otherwise it repeats every
 * `intervalMinutes`.
 */

const DAY_MS = 86_400_000
const NS_PER_MS = 1_000_000n
const MINUTE_MS = 60_000
const CRON_FIELDS = [
  { key: 'minute', min: 0, max: 59 },
  { key: 'hour', min: 0, max: 23 },
  { key: 'day', min: 1, max: 31 },
  { key: 'month', min: 1, max: 12 },
  { key: 'weekday', min: 0, max: 7 },
]

/** Expand one cron field into the set of matching integers. */
function parseCronField(text, { key, min, max }) {
  const field = new Set()
  for (const part of text.split(',')) {
    const piece = part.trim()
    if (piece === '') throw new TypeError(`cron ${key}: empty list item`)
    const [rangeText, stepText, ...rest] = piece.split('/')
    if (rest.length > 0) throw new TypeError(`cron ${key}: malformed step in '${piece}'`)
    let step = 1
    if (stepText !== undefined) {
      if (!/^\d+$/.test(stepText) || Number(stepText) < 1) {
        throw new TypeError(`cron ${key}: step must be a positive integer`)
      }
      step = Number(stepText)
    }
    let from
    let to
    if (rangeText === '*') {
      from = min
      to = max
    } else if (rangeText.includes('-')) {
      const [startText, endText, ...extra] = rangeText.split('-')
      if (extra.length > 0) throw new TypeError(`cron ${key}: malformed range '${rangeText}'`)
      if (!/^\d+$/.test(startText) || !/^\d+$/.test(endText)) {
        throw new TypeError(`cron ${key}: range must be numeric`)
      }
      from = Number(startText)
      to = Number(endText)
    } else {
      if (!/^\d+$/.test(rangeText)) throw new TypeError(`cron ${key}: '${rangeText}' is not a number`)
      from = Number(rangeText)
      to = stepText === undefined ? from : max
    }
    if (from < min || to > max || from > to) {
      throw new TypeError(`cron ${key}: '${piece}' is outside ${min}..${max}`)
    }
    for (let value = from; value <= to; value += step) field.add(value)
  }
  return field
}

/** Parse a five-field cron expression (local time) into match sets. */
export function parseCron(expression) {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) {
    throw new TypeError(`cron '${expression}' must have five fields (minute hour day month weekday)`)
  }
  const [minute, hour, day, month, weekday] = fields.map((text, index) =>
    parseCronField(text, CRON_FIELDS[index]),
  )
  // 7 and 0 both mean Sunday.
  if (weekday.has(7)) weekday.add(0)
  return { expression, minute, hour, day, month, weekday, dayRestricted: fields[2] !== '*', weekdayRestricted: fields[4] !== '*' }
}

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/**
 * Wall-clock fields of `date` in `timeZone` (IANA name) — the clock a cron
 * expression is written against. Without a zone the host's own zone is used,
 * which is what a process inheriting `/etc/localtime` expects.
 */
export function wallClock(date, timeZone) {
  if (!timeZone) {
    return {
      minute: date.getMinutes(),
      hour: date.getHours(),
      day: date.getDate(),
      month: date.getMonth() + 1,
      weekday: date.getDay(),
    }
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    weekday: 'short',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(date)
  const read = (type) => parts.find((part) => part.type === type)?.value
  const weekday = WEEKDAY_INDEX[read('weekday')]
  if (weekday === undefined) throw new TypeError(`cannot resolve weekday for time zone '${timeZone}'`)
  return {
    minute: Number(read('minute')),
    hour: Number(read('hour')) % 24,
    day: Number(read('day')),
    month: Number(read('month')),
    weekday,
  }
}

/** Whether a parsed cron expression fires during the given minute. */
export function cronMatches(cron, date, timeZone) {
  const clock = wallClock(date, timeZone ?? cron.timeZone)
  if (!cron.minute.has(clock.minute)) return false
  if (!cron.hour.has(clock.hour)) return false
  if (!cron.month.has(clock.month)) return false
  const dayOk = cron.day.has(clock.day)
  const weekdayOk = cron.weekday.has(clock.weekday)
  // Vixie cron: when both day-of-month and day-of-week are restricted, either may match.
  if (cron.dayRestricted && cron.weekdayRestricted) return dayOk || weekdayOk
  if (cron.dayRestricted) return dayOk
  if (cron.weekdayRestricted) return weekdayOk
  return true
}

/** Dependency-free standard-schema so cordis can validate the row config. */
export const Config = {
  '~standard': {
    version: 1,
    vendor: 'dsh-auto-archive',
    validate(input) {
      try {
        return { value: resolveConfig(input) }
      } catch (error) {
        return {
          issues: [{ message: error instanceof Error ? error.message : String(error) }],
        }
      }
    },
  },
}

function integerOption(config, key, fallback, min, max) {
  const value = config[key]
  if (value === undefined || value === null) return fallback
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TypeError(`${key} must be an integer in ${min}..${max}, got ${String(value)}`)
  }
  return value
}

function booleanOption(config, key, fallback) {
  const value = config[key]
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'boolean') throw new TypeError(`${key} must be a boolean`)
  return value
}

/** Validate an IANA time-zone name, or `null` for the host's own zone. */
export function resolveTimeZone(value) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new TypeError('timeZone must be an IANA name such as Europe/Berlin')
  const name = value.trim()
  if (name === '') return null
  try {
    // Throws RangeError for an unknown zone.
    new Intl.DateTimeFormat('en-US', { timeZone: name }).format(0)
  } catch {
    throw new TypeError(`timeZone '${name}' is not a known IANA time zone`)
  }
  return name
}

export function resolveConfig(input) {
  const config = input && typeof input === 'object' ? input : {}
  const logPath = config.logPath
  if (logPath !== undefined && logPath !== null && typeof logPath !== 'string') {
    throw new TypeError('logPath must be a string')
  }
  const timeZone = resolveTimeZone(config.timeZone)
  // `Config['~standard'].validate` already resolved the row config once before
  // `apply` sees it, so accept the parsed cron object as well as the text form.
  const cronText = config.cron
  let cron
  if (cronText === undefined || cronText === null) cron = null
  else if (typeof cronText === 'string') cron = cronText.trim() === '' ? null : { ...parseCron(cronText), timeZone }
  else if (typeof cronText === 'object' && cronText.minute instanceof Set) cron = { ...cronText, timeZone: cronText.timeZone ?? timeZone }
  else throw new TypeError('cron must be a five-field cron string')
  return {
    enabled: booleanOption(config, 'enabled', true),
    cron,
    timeZone,
    intervalMinutes: integerOption(config, 'intervalMinutes', 60, 1, 43_200),
    idleDays: integerOption(config, 'idleDays', 30, 1, 36_500),
    dryRun: booleanOption(config, 'dryRun', false),
    maxPerRun: integerOption(config, 'maxPerRun', 50, 1, 1_000),
    stopActivity: booleanOption(config, 'stopActivity', false),
    logPath: typeof logPath === 'string' && logPath.trim() !== '' ? logPath.trim() : null,
  }
}

/** Parse the persistence revision token into an epoch-ms mtime, or `null`. */
export function revisionMtime(revision) {
  if (typeof revision !== 'string') return null
  const parts = revision.split(':')
  if (parts.length !== 5) return null
  const [, , , mtimeNs, ctimeNs] = parts
  if (!/^\d+$/.test(mtimeNs ?? '') || !/^\d+$/.test(ctimeNs ?? '')) return null
  try {
    return Number(BigInt(mtimeNs) / NS_PER_MS)
  } catch {
    return null
  }
}

/** Favourite session ids recorded by the archive manager, if it is mounted. */
export function favoriteSessionIds(ctx) {
  try {
    const domain = ctx.get('storageDomain')?.get?.('archive_manager_favorites')
    const value = domain?.global?.get?.()
    const ids = value?.favoriteSessionIds
    return Array.isArray(ids) ? new Set(ids.filter((id) => typeof id === 'string')) : new Set()
  } catch {
    return new Set()
  }
}

/** Cached `lastPromptAt` for one stored session, when a projection cache exists. */
async function projectedLastPromptAt(ctx, snapshot) {
  const cache = ctx.get('sessionProjectionCache')
  if (cache === undefined || typeof cache.cachedSnapshot !== 'function') return null
  try {
    const projection = await cache.cachedSnapshot(snapshot, ['sessionListMetadata'])
    const lastPromptAt = projection?.values?.sessionListMetadata?.lastPromptAt
    return typeof lastPromptAt === 'number' && Number.isFinite(lastPromptAt) ? lastPromptAt : null
  } catch {
    return null
  }
}

/**
 * Select archive candidates from persistence snapshots.
 * Pure apart from the projection-cache read; exported for testing.
 */
export async function selectCandidates(ctx, config, { now = Date.now() } = {}) {
  const persistence = ctx.get('sessionPersistence')
  if (persistence === undefined || typeof persistence.list !== 'function') {
    throw new Error('sessionPersistence is unavailable')
  }
  const workspace = ctx.workspaceRegistry
  const archived = new Set(workspace.archivedSessionIds ?? [])
  const pinned = new Set(workspace.pinnedSessionIds ?? [])
  const favorites = favoriteSessionIds(ctx)
  const cutoff = now - config.idleDays * DAY_MS
  const snapshots = await persistence.list()
  const candidates = []
  const skipped = { archived: 0, pinned: 0, favorite: 0, tooRecent: 0, unknownActivity: 0 }

  for (const snapshot of snapshots) {
    const id = snapshot?.header?.id
    if (typeof id !== 'string' || id === '') continue
    if (archived.has(id)) {
      skipped.archived += 1
      continue
    }
    if (pinned.has(id)) {
      skipped.pinned += 1
      continue
    }
    if (favorites.has(id)) {
      skipped.favorite += 1
      continue
    }
    const created = typeof snapshot.header.createdAt === 'number' ? snapshot.header.createdAt : null
    const mtime = revisionMtime(snapshot.revision)
    const prompted = await projectedLastPromptAt(ctx, snapshot)
    const activity = Math.max(created ?? 0, mtime ?? 0, prompted ?? 0)
    if (!Number.isFinite(activity) || activity <= 0) {
      skipped.unknownActivity += 1
      continue
    }
    if (activity > cutoff) {
      skipped.tooRecent += 1
      continue
    }
    candidates.push({ id, activity, createdAt: created })
  }

  candidates.sort((left, right) => left.activity - right.activity)
  // Not capped here: `runSweep` caps by *successful* archives, so a refused
  // (still running) session cannot starve the rest of the queue.
  return { candidates, considered: snapshots.length, olderThan: cutoff, skipped }
}

/** One sweep: select, then archive through the official registry call. */
export async function runSweep(ctx, config, { now = Date.now() } = {}) {
  const startedAt = now
  const selection = await selectCandidates(ctx, config, { now })
  const archived = []
  const refused = []
  const failed = []

  if (config.dryRun !== true) {
    for (const candidate of selection.candidates) {
      if (archived.length >= config.maxPerRun) break
      try {
        // No `stopActivity`: DSH refuses active sessions instead of killing them.
        await ctx.workspaceRegistry.archiveSession(candidate.id, {
          stopActivity: config.stopActivity === true,
        })
        archived.push(candidate.id)
      } catch (error) {
        const name = error?.name ?? error?.constructor?.name ?? 'Error'
        const message = error instanceof Error ? error.message : String(error)
        const record = { id: candidate.id, name, message: message.slice(0, 300) }
        if (name === 'WorkspaceActiveSessionError' || name === 'WorkspaceUnknownSessionError') {
          refused.push(record)
        } else {
          failed.push(record)
        }
      }
    }
  }

  return {
    startedAt,
    finishedAt: Date.now(),
    dryRun: config.dryRun === true,
    idleDays: config.idleDays,
    considered: selection.considered,
    olderThan: selection.olderThan,
    skipped: selection.skipped,
    candidates: selection.candidates.map((candidate) => ({
      id: candidate.id,
      idleMs: startedAt - candidate.activity,
    })),
    archived,
    refused,
    failed,
  }
}

/** Append one JSON line to the configured run log; failures never break a sweep. */
export async function appendRunLog(logPath, entry) {
  if (!logPath) return
  try {
    const { appendFile, mkdir } = await import('node:fs/promises')
    const { dirname } = await import('node:path')
    await mkdir(dirname(logPath), { recursive: true })
    await appendFile(logPath, `${JSON.stringify(entry)}\n`, 'utf8')
  } catch {
    // A logging failure must not abort archiving.
  }
}

export const name = 'dsh-auto-archive'
export const inject = ['timer', 'workspaceRegistry', 'sessionPersistence']

export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig)
  const logger = ctx.logger('auto-archive')
  const logPath = config.logPath ?? defaultLogPath(ctx)

  if (!config.enabled) {
    logger.info('auto-archive disabled by config')
    return
  }

  let sweeping = false
  let lastRun = null
  let lastError = null

  const tick = async (reason) => {
    if (sweeping) return
    sweeping = true
    try {
      const report = await runSweep(ctx, config)
      lastRun = { reason, ...report }
      lastError = null
      logger.info(
        `${reason}: archived ${report.archived.length}/${report.considered} considered ` +
          `(idleDays=${report.idleDays}${report.dryRun ? ', dry run' : ''})`,
      )
      await appendRunLog(logPath, { at: new Date(report.startedAt).toISOString(), reason, ...report })
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      logger.warn(`auto-archive sweep failed: ${lastError}`)
      await appendRunLog(logPath, {
        at: new Date().toISOString(),
        reason,
        error: lastError,
      })
    } finally {
      sweeping = false
    }
  }

  // Drive from one minute-resolution clock. With `cron` the sweep fires on a
  // matching minute; otherwise it fires every `intervalMinutes`. A per-minute
  // tick that only matches once guards against double-firing inside a minute.
  let lastSweepAt = 0
  let lastIntervalSlot = null
  const clock = () => {
    const now = new Date()
    if (config.cron !== null) {
      if (!cronMatches(config.cron, now)) return
      const slot = Math.floor(now.getTime() / MINUTE_MS)
      if (slot === lastIntervalSlot) return
      lastIntervalSlot = slot
      void tick(`cron ${config.cron.expression}`)
      return
    }
    const intervalMs = config.intervalMinutes * MINUTE_MS
    if (lastSweepAt === 0) {
      lastSweepAt = Date.now()
      return
    }
    if (Date.now() - lastSweepAt < intervalMs) return
    lastSweepAt = Date.now()
    void tick('interval')
  }

  // First sweep shortly after boot so a reload does not hammer the registry,
  // then on the configured schedule.
  ctx.timeout(() => void tick('startup'), 2 * MINUTE_MS)
  ctx.interval(clock, MINUTE_MS)

  // Optional manual surface: the service handle lets another plugin (or a
  // subagent driving `dsh`) trigger and inspect a sweep.
  ctx.provide('autoArchive', {
    config,
    sweep: (reason = 'manual') => tick(reason),
    status: () => ({ config, lastRun, lastError, logPath }),
  })

  logger.info(
    (config.cron !== null
      ? `cron '${config.cron.expression}' (${config.cron.timeZone ?? 'host-local time'})`
      : `every ${config.intervalMinutes}min`) +
      `, idleDays=${config.idleDays}${config.dryRun ? ', dry run' : ''}, log=${logPath}`,
  )
}

/** `<DSH_HOME>/auto-archive.log`, falling back to the process cwd. */
function defaultLogPath(ctx) {
  const home = process.env.DSH_HOME
  if (typeof home === 'string' && home.trim() !== '') {
    return `${home.replace(/\/+$/, '')}/auto-archive.log`
  }
  return 'auto-archive.log'
}
