/**
 * dsh-hevy-training — host half.
 *
 * Fenced same-origin routes under `/dsh-hevy-training` that read the Hevy
 * public API with the host's `HEVY_API_KEY` and hand the Web GUI one
 * pre-aggregated payload. Keeping the credential on the host is the whole
 * point: the browser never sees the key, and the panel keeps working while
 * no agent turn is running (the MCP server is a per-session stdio child, so
 * it cannot serve a panel on its own).
 *
 * Routes, all `GET`:
 *   /dsh-hevy-training/overview   → totals, weekly load, muscle balance,
 *                                   lift progression, PRs, recent sessions,
 *                                   weight trend, session quality, notes
 *   /dsh-hevy-training/session    → one session's full set detail (`?id=`)
 *   /dsh-hevy-training/status     → credential/config probe for the panel
 *   /dsh-hevy-training/snapshot   → versioned, diff-oriented JSON plus the
 *                                   diff against the previous stored day
 *   /dsh-hevy-training/digest.md  → the same facts as a markdown brief
 *
 * The two snapshot routes exist for automated weekly review rather than for
 * the panel: they read like a document, not a UI payload.
 *
 * Read-only by design. Hevy has no delete or undo on any object, and
 * `POST /v1/workouts` / `POST /v1/routines` are not idempotent, so a replayed
 * write would silently duplicate a real training session. Version 0.1
 * therefore issues `GET` only.
 *
 * @module dsh-hevy-training
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

import { createHevyClient, HevyError } from './hevy.js'
import {
  SNAPSHOT_SCHEMA_VERSION,
  buildOverview,
  buildSnapshot,
  dayKeyOf,
  digestMarkdown,
  diffSnapshots,
} from './aggregate.js'
import {
  HISTORY_LIMIT,
  loadPreviousSnapshot,
  pruneSnapshots,
  saveSnapshot,
} from './history.js'

/** Plugin name shown in the loader and plugin manager. */
export const name = 'dsh-hevy-training'

/** Host services this half needs. `connection` is optional-probed by `guard`. */
export const inject = ['webServer']

/** Route prefix owned by this plugin. */
const PREFIX = '/dsh-hevy-training'

/** Trailing weeks in the default view. */
const DEFAULT_WEEKS = 12

/** Days of history folded into the muscle-balance window. */
const DEFAULT_MUSCLE_WINDOW_DAYS = 28

/** Days of history folded into the session-quality window. */
const DEFAULT_QUALITY_WINDOW_DAYS = 42

/** How long one aggregated payload stays warm. */
const DEFAULT_CACHE_SECONDS = 300

/** Daily snapshots retained for week-over-week diffs. */
const DEFAULT_HISTORY_DAYS = HISTORY_LIMIT

/** Bounds accepted for `weeks`, the muscle window and the quality window. */
const WEEK_LIMIT = { min: 1, max: 52 }
const MUSCLE_WINDOW_LIMIT = { min: 7, max: 365 }
const QUALITY_WINDOW_LIMIT = { min: 7, max: 365 }

/**
 * Validate one integer query parameter.
 * @param {number} value - parsed candidate.
 * @param {{min: number, max: number}} limit - accepted range.
 * @param {number} fallback - value used when the candidate is unusable.
 * @returns {number} in-range integer.
 */
function clampInt(value, limit, fallback) {
  if (!Number.isFinite(value)) return fallback
  return Math.min(limit.max, Math.max(limit.min, Math.trunc(value)))
}

/**
 * Whether one value is an acceptable IANA time-zone name.
 * @param {string} value - candidate zone.
 * @returns {boolean} true when `Intl` accepts it.
 */
function isTimeZone(value) {
  if (typeof value !== 'string' || value.trim() === '') return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0)
    return true
  } catch {
    return false
  }
}

/**
 * Resolve the plugin config with defaults and bounds.
 * @param {object|undefined} input - raw row config.
 * @returns {object} resolved config.
 */
export function resolveConfig(input) {
  const config = input && typeof input === 'object' ? input : {}
  const text = (key) => {
    const value = config[key]
    if (value === undefined || value === null) return null
    if (typeof value !== 'string') throw new TypeError(`${key} must be a string`)
    return value.trim() === '' ? null : value.trim()
  }
  const integer = (key, fallback, min, max) => {
    const value = config[key]
    if (value === undefined || value === null) return fallback
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new TypeError(`${key} must be an integer in ${min}..${max}`)
    }
    return value
  }
  const timeZone = text('timeZone')
  if (timeZone !== null && !isTimeZone(timeZone)) {
    throw new TypeError(`timeZone '${timeZone}' is not a known IANA time zone`)
  }
  const baseUrl = text('baseUrl')
  if (baseUrl !== null && !/^https?:\/\//.test(baseUrl)) {
    throw new TypeError('baseUrl must be an http(s) origin')
  }
  const enabled = config.enabled
  if (enabled !== undefined && enabled !== null && typeof enabled !== 'boolean') {
    throw new TypeError('enabled must be a boolean')
  }
  /*
   * Left null here and resolved inside `apply`. An absolute default baked into
   * `resolveConfig` would make this pure function environment-dependent and
   * untestable; the caller knows where the host keeps its state.
   */
  const historyDir = text('historyDir')
  return {
    enabled: enabled ?? true,
    apiKey: text('apiKey'),
    baseUrl: baseUrl ?? 'https://api.hevyapp.com',
    timeZone,
    weeks: integer('weeks', DEFAULT_WEEKS, WEEK_LIMIT.min, WEEK_LIMIT.max),
    muscleWindowDays: integer('muscleWindowDays', DEFAULT_MUSCLE_WINDOW_DAYS, MUSCLE_WINDOW_LIMIT.min, MUSCLE_WINDOW_LIMIT.max),
    qualityWindowDays: integer('qualityWindowDays', DEFAULT_QUALITY_WINDOW_DAYS, QUALITY_WINDOW_LIMIT.min, QUALITY_WINDOW_LIMIT.max),
    historyDir,
    snapshotHistoryDays: integer('snapshotHistoryDays', DEFAULT_HISTORY_DAYS, 0, 365),
    cacheSeconds: integer('cacheSeconds', DEFAULT_CACHE_SECONDS, 0, 3600),
  }
}

/** Dependency-free standard-schema so the loader can validate the row config. */
export const Config = {
  '~standard': {
    version: 1,
    vendor: 'dsh-hevy-training',
    validate(input) {
      try {
        return { value: resolveConfig(input) }
      } catch (error) {
        return { issues: [{ message: error instanceof Error ? error.message : String(error) }] }
      }
    },
  },
}

/**
 * Refuse a request the connection layer rejects, and enforce the method.
 * @param {object} ctx - plugin context.
 * @param {import('node:http').IncomingMessage} req - request.
 * @param {import('node:http').ServerResponse} res - response.
 * @param {string[]} methods - accepted methods.
 * @returns {boolean} true when the handler should continue.
 */
function guard(ctx, req, res, methods) {
  const connection = ctx.get('connection')
  if (connection !== undefined && connection.requestRejection(req) !== undefined) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('forbidden')
    return false
  }
  if (!methods.includes(req.method ?? 'GET')) {
    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: methods.join(', ') })
    res.end('method not allowed')
    return false
  }
  return true
}

/**
 * Write one JSON response.
 * @param {import('node:http').ServerResponse} res - response.
 * @param {number} status - HTTP status.
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
 * Register the plugin's routes.
 *
 * The loader hands the row's Config in as the second argument; `ctx.config` is
 * only reachable after injecting the `config` service, so reading it there
 * would fail activation with `cannot get property "config" without inject`.
 *
 * @param {object} ctx - plugin context.
 * @param {object|undefined} rawConfig - validated Config for this row.
 * @returns {void}
 */
export function apply(ctx, rawConfig) {
  const settings = resolveConfig(rawConfig ?? {})

  /** One cached aggregate, keyed by the parameters that shaped it. */
  let cache = null

  /**
   * Resolve the API key: explicit config wins, otherwise the host environment.
   * @returns {string|null} trimmed key.
   */
  function apiKey() {
    const fromConfig = settings.apiKey
    if (typeof fromConfig === 'string' && fromConfig !== '') return fromConfig
    const fromEnv = process.env.HEVY_API_KEY
    return typeof fromEnv === 'string' && fromEnv.trim() !== '' ? fromEnv.trim() : null
  }

  /**
   * Build a client, or throw a diagnostic error.
   * @returns {object} Hevy client.
   */
  function client() {
    const key = apiKey()
    if (key === null) {
      throw new HevyError(
        'HEVY_API_KEY is not set for the host process; export it (or set the row config apiKey) and restart',
        null,
        '',
      )
    }
    return createHevyClient({ apiKey: key, baseUrl: settings.baseUrl })
  }

  /**
   * Resolve the zone used for calendar bucketing.
   * @returns {string} IANA zone name.
   */
  function timeZone() {
    if (settings.timeZone !== null) return settings.timeZone
    const ambient = Intl.DateTimeFormat().resolvedOptions().timeZone
    return isTimeZone(ambient) ? ambient : 'UTC'
  }

  /**
   * Where daily snapshot documents live.
   *
   * Defaults under the DSH home so the file sits with the rest of the harness
   * state rather than in the plugin's own source tree, and so it survives the
   * plugin being reinstalled or moved.
   *
   * @returns {string} absolute directory path.
   */
  function historyDir() {
    if (settings.historyDir !== null) return settings.historyDir
    const home = process.env.DSH_HOME
    const root = typeof home === 'string' && home.trim() !== '' ? home.trim() : join(homedir(), '.dsh')
    return join(root, 'hevy-training-snapshots')
  }

  /**
   * Report a non-fatal problem without failing the request.
   *
   * `ctx.logger` is a factory on some builds and an object on others, and it
   * may be absent entirely; history bookkeeping is not worth an exception.
   *
   * @param {string} message - diagnostic text.
   * @returns {void}
   */
  function warn(message) {
    try {
      const logger = ctx.logger
      if (typeof logger === 'function') logger('dsh-hevy-training').warn(message)
      else if (typeof logger?.warn === 'function') logger.warn(`dsh-hevy-training: ${message}`)
      else console.warn(`dsh-hevy-training: ${message}`)
    } catch {
      /* Diagnostics must never be the reason a request fails. */
    }
  }

  /**
   * Build this request's snapshot and persist it, returning the document plus
   * the stored previous day's document when one exists.
   *
   * The write is best-effort on purpose: a read-only filesystem or a broken
   * history directory must degrade to "snapshot without a diff", never to a
   * failed request that hides the athlete's training data.
   *
   * @param {object} raw - raw Hevy collections.
   * @param {object} options - window sizes and reference time.
   * @returns {Promise<{snapshot: object, previous: object|null, previousDay: string|null, stored: string|null}>} snapshot bundle.
   */
  async function snapshotWithHistory(raw, options) {
    const snapshot = buildSnapshot({ ...raw, ...options })
    const dir = historyDir()
    let previous = null
    let previousDay = null
    let stored = null
    try {
      previous = await loadPreviousSnapshot(dir, snapshot.asOf)
      previousDay = previous?.dayKey ?? null
      stored = await saveSnapshot(dir, snapshot)
      if (settings.snapshotHistoryDays > 0) await pruneSnapshots(dir, settings.snapshotHistoryDays)
    } catch (error) {
      warn(`snapshot history unavailable (${String(error?.message ?? error)})`)
    }
    return { snapshot, previous: previous?.document ?? null, previousDay, stored }
  }

  /**
   * Fetch every raw collection the aggregate needs, in parallel.
   * @returns {Promise<object>} raw collections.
   */
  async function fetchRaw() {
    const hevy = client()
    const [workouts, templates, measurements, user] = await Promise.all([
      hevy.fetchWorkouts(),
      hevy.fetchTemplates(),
      hevy.fetchMeasurements(),
      hevy.fetchUser().catch(() => null),
    ])
    return { workouts, templates, measurements, user }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: `${PREFIX}/overview`,
    handler: async (req, res) => {
      if (!guard(ctx, req, res, ['GET'])) return
      if (!settings.enabled) {
        json(res, 503, { ok: false, error: 'dsh-hevy-training is disabled in its plugin config' })
        return
      }
      try {
        const url = new URL(req.url ?? '/', 'http://dsh.internal')
        const weeks = clampInt(Number(url.searchParams.get('weeks') ?? settings.weeks), WEEK_LIMIT, settings.weeks)
        const muscleWindowDays = clampInt(
          Number(url.searchParams.get('muscleWindowDays') ?? settings.muscleWindowDays),
          MUSCLE_WINDOW_LIMIT,
          settings.muscleWindowDays,
        )
        const qualityWindowDays = clampInt(
          Number(url.searchParams.get('qualityWindowDays') ?? settings.qualityWindowDays),
          QUALITY_WINDOW_LIMIT,
          settings.qualityWindowDays,
        )
        const zone = timeZone()
        const cacheKey = `${weeks}|${muscleWindowDays}|${qualityWindowDays}|${zone}`
        const nowMs = Date.now()
        if (cache !== null && cache.key === cacheKey && nowMs - cache.at < settings.cacheSeconds * 1000) {
          json(res, 200, { ok: true, value: { ...cache.value, cached: true } })
          return
        }
        const raw = await fetchRaw()
        const value = buildOverview({
          ...raw,
          weeks,
          muscleWindowDays,
          qualityWindowDays,
          timeZone: zone,
          now: new Date(nowMs),
        })
        cache = { key: cacheKey, at: nowMs, value }
        json(res, 200, { ok: true, value: { ...value, cached: false } })
      } catch (error) {
        const status = error instanceof HevyError && error.status === 401 ? 401 : 502
        json(res, status, { ok: false, error: String(error?.message ?? error) })
      }
    },
  }), 'dsh-hevy-training: /dsh-hevy-training/overview route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: `${PREFIX}/session`,
    handler: async (req, res) => {
      if (!guard(ctx, req, res, ['GET'])) return
      if (!settings.enabled) {
        json(res, 503, { ok: false, error: 'dsh-hevy-training is disabled in its plugin config' })
        return
      }
      try {
        const url = new URL(req.url ?? '/', 'http://dsh.internal')
        const id = url.searchParams.get('id')
        if (id === null || id === '') {
          json(res, 400, { ok: false, error: 'id is required' })
          return
        }
        const hevy = client()
        const body = await hevy.request(`/v1/workouts/${encodeURIComponent(id)}`)
        const workout = body?.workout ?? body
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ ok: true, value: workout }))
      } catch (error) {
        const status = error instanceof HevyError && error.status === 404 ? 404 : 502
        json(res, status, { ok: false, error: String(error?.message ?? error) })
      }
    },
  }), 'dsh-hevy-training: /dsh-hevy-training/session route')

  /*
   * The two routes below exist for automated review, not for the panel.
   * `/overview` is shaped for rendering — nested, presentation-oriented, and
   * free to change whenever a chart changes. These are shaped for reading a
   * week later: versioned, flat, and diffable.
   */
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: `${PREFIX}/snapshot`,
    handler: async (req, res) => {
      if (!guard(ctx, req, res, ['GET'])) return
      if (!settings.enabled) {
        json(res, 503, { ok: false, error: 'dsh-hevy-training is disabled in its plugin config' })
        return
      }
      try {
        const url = new URL(req.url ?? '/', 'http://dsh.internal')
        const weeks = clampInt(Number(url.searchParams.get('weeks') ?? settings.weeks), WEEK_LIMIT, settings.weeks)
        const muscleWindowDays = clampInt(
          Number(url.searchParams.get('muscleWindowDays') ?? settings.muscleWindowDays),
          MUSCLE_WINDOW_LIMIT,
          settings.muscleWindowDays,
        )
        const qualityWindowDays = clampInt(
          Number(url.searchParams.get('qualityWindowDays') ?? settings.qualityWindowDays),
          QUALITY_WINDOW_LIMIT,
          settings.qualityWindowDays,
        )
        const raw = await fetchRaw()
        const store = url.searchParams.get('store') !== '0'
        if (!store) {
          const snapshot = buildSnapshot({
            ...raw,
            weeks,
            muscleWindowDays,
            qualityWindowDays,
            timeZone: timeZone(),
            now: new Date(),
          })
          json(res, 200, { ok: true, value: { snapshot, diff: null, previousAt: null, stored: null } })
          return
        }
        const bundle = await snapshotWithHistory(raw, {
          weeks,
          muscleWindowDays,
          qualityWindowDays,
          timeZone: timeZone(),
          now: new Date(),
        })
        json(res, 200, {
          ok: true,
          value: {
            snapshot: bundle.snapshot,
            diff: diffSnapshots(bundle.previous, bundle.snapshot),
            previousAt: bundle.previous?.generatedAt ?? null,
            stored: bundle.stored,
          },
        })
      } catch (error) {
        const status = error instanceof HevyError && error.status === 401 ? 401 : 502
        json(res, status, { ok: false, error: String(error?.message ?? error) })
      }
    },
  }), 'dsh-hevy-training: /dsh-hevy-training/snapshot route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: `${PREFIX}/digest.md`,
    handler: async (req, res) => {
      if (!guard(ctx, req, res, ['GET'])) return
      if (!settings.enabled) {
        res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('dsh-hevy-training is disabled in its plugin config\n')
        return
      }
      try {
        const url = new URL(req.url ?? '/', 'http://dsh.internal')
        const weeks = clampInt(Number(url.searchParams.get('weeks') ?? settings.weeks), WEEK_LIMIT, settings.weeks)
        const muscleWindowDays = clampInt(
          Number(url.searchParams.get('muscleWindowDays') ?? settings.muscleWindowDays),
          MUSCLE_WINDOW_LIMIT,
          settings.muscleWindowDays,
        )
        const qualityWindowDays = clampInt(
          Number(url.searchParams.get('qualityWindowDays') ?? settings.qualityWindowDays),
          QUALITY_WINDOW_LIMIT,
          settings.qualityWindowDays,
        )
        const raw = await fetchRaw()
        /*
         * Read-only: the digest must not become the thing that writes history,
         * or fetching it twice moves the diff baseline. `/snapshot` records;
         * this only reports.
         */
        const now = new Date()
        const todayKey = dayKeyOf(now, timeZone())
        const previous = todayKey === null
          ? null
          : await loadPreviousSnapshot(historyDir(), todayKey).catch(() => null)
        const snapshot = buildSnapshot({
          ...raw,
          weeks,
          muscleWindowDays,
          qualityWindowDays,
          timeZone: timeZone(),
          now,
        })
        const text = digestMarkdown(snapshot, previous?.document ?? null)
        res.writeHead(200, {
          'content-type': 'text/markdown; charset=utf-8',
          'cache-control': 'no-store',
          'content-length': String(Buffer.byteLength(text)),
        })
        res.end(text)
      } catch (error) {
        const status = error instanceof HevyError && error.status === 401 ? 401 : 502
        res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
        res.end(`${String(error?.message ?? error)}\n`)
      }
    },
  }), 'dsh-hevy-training: /dsh-hevy-training/digest.md route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: `${PREFIX}/status`,
    handler: async (req, res) => {
      if (!guard(ctx, req, res, ['GET'])) return
      const key = apiKey()
      json(res, 200, {
        ok: true,
        value: {
          enabled: settings.enabled,
          hasApiKey: key !== null,
          keySource: settings.apiKey !== null ? 'config' : key !== null ? 'env' : null,
          baseUrl: settings.baseUrl,
          timeZone: timeZone(),
          weeks: settings.weeks,
          muscleWindowDays: settings.muscleWindowDays,
          qualityWindowDays: settings.qualityWindowDays,
          snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
          historyDir: historyDir(),
          snapshotHistoryDays: settings.snapshotHistoryDays,
          cacheSeconds: settings.cacheSeconds,
          today: dayKeyOf(new Date(), timeZone()),
        },
      })
    },
  }), 'dsh-hevy-training: /dsh-hevy-training/status route')
}
