/**
 * dsh-hevy-training — pure aggregation.
 *
 * Turns raw Hevy API documents into the single shape the panel renders:
 * weekly training load, muscle-group balance, body-weight trend, per-lift
 * progression and recent session detail. No I/O, no clock of its own — the
 * caller passes `now`, `timeZone` and the raw arrays, which keeps every
 * number here reproducible in a test.
 *
 * Hevy's field names are preserved verbatim (`start_time`, `weight_kg`,
 * `exercise_template_id`, `primary_muscle_group`, ...); only response
 * envelopes are unwrapped by `lib/hevy.js`.
 *
 * @module dsh-hevy-training/aggregate
 */

/** Milliseconds in one day. */
const DAY_MS = 86_400_000

/** Muscle groups in display order, matching Hevy's template vocabulary. */
export const MUSCLE_ORDER = [
  'chest', 'upper_back', 'lats', 'shoulders', 'traps', 'lower_back',
  'biceps', 'triceps', 'forearms', 'abdominals', 'obliques',
  'quadriceps', 'hamstrings', 'glutes', 'abductors', 'adductors',
  'calves', 'neck', 'full_body', 'cardio', 'other',
]

/** Set types that are logged but not counted as working volume. */
const NON_WORKING_SET_TYPES = new Set(['warmup'])

/** Secondary muscles earn this fraction of a working set. */
const SECONDARY_MUSCLE_CREDIT = 0.5

/** A muscle group with no work in this many days reads as neglected. */
export const STALE_AFTER_DAYS = 14

/** A lift's e1RM improvement inside this window counts as a fresh PR. */
const PR_WINDOW_DAYS = 30

/**
 * Days folded into the session-quality summary. Six weeks matches the journal's
 * "no failure for six weeks, then RPE 7 → 8" progression rule.
 */
export const QUALITY_WINDOW_DAYS = 42

/** A within-exercise best-to-worst drop-off at or above this reads as a collapse. */
export const DROPOFF_ALERT_PCT = 25

/** Body weight should be logged at least this often to stay a usable signal. */
export const WEIGHT_STALE_AFTER_DAYS = 7

/** Cached `Intl.DateTimeFormat` per time zone. */
const formatters = new Map()

/**
 * `Intl.DateTimeFormat` for one time zone, memoized.
 * @param {string} timeZone - IANA zone name.
 * @returns {Intl.DateTimeFormat} formatter emitting year/month/day parts.
 */
function formatterFor(timeZone) {
  let formatter = formatters.get(timeZone)
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    formatters.set(timeZone, formatter)
  }
  return formatter
}

/**
 * Calendar day of one instant in a time zone, as `YYYY-MM-DD`.
 * @param {string|Date} instant - ISO timestamp or Date.
 * @param {string} timeZone - IANA zone name.
 * @returns {string|null} day key, or null when the instant is unusable.
 */
export function dayKeyOf(instant, timeZone) {
  const date = instant instanceof Date ? instant : new Date(String(instant))
  if (Number.isNaN(date.getTime())) return null
  const parts = formatterFor(timeZone).formatToParts(date)
  const pick = (type) => parts.find((part) => part.type === type)?.value ?? ''
  const year = pick('year')
  const month = pick('month')
  const day = pick('day')
  if (year === '' || month === '' || day === '') return null
  return `${year}-${month}-${day}`
}

/**
 * Day index of a `YYYY-MM-DD` key, counted in UTC days.
 * @param {string} key - calendar day key.
 * @returns {number} whole days since the epoch.
 */
export function dayNumberOf(key) {
  const [year, month, day] = key.split('-').map(Number)
  return Math.floor(Date.UTC(year, (month ?? 1) - 1, day ?? 1) / DAY_MS)
}

/**
 * Render a day index back to `YYYY-MM-DD`.
 * @param {number} dayNumber - whole days since the epoch.
 * @returns {string} calendar day key.
 */
export function dayKeyOfNumber(dayNumber) {
  return new Date(dayNumber * DAY_MS).toISOString().slice(0, 10)
}

/**
 * Monday-based week start containing one day index.
 * @param {number} dayNumber - whole days since the epoch.
 * @returns {number} day index of that week's Monday.
 */
export function weekStartOf(dayNumber) {
  const weekday = new Date(dayNumber * DAY_MS).getUTCDay()
  return dayNumber - ((weekday + 6) % 7)
}

/**
 * Round a number to a fixed number of decimals.
 * @param {number} value - raw value.
 * @param {number} decimals - decimal places.
 * @returns {number} rounded value.
 */
function round(value, decimals = 1) {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/**
 * Estimated one-rep max (Epley).
 * @param {number|null} weightKg - working weight.
 * @param {number|null} reps - repetitions performed.
 * @returns {number} estimated 1RM in kilograms, 0 when uncomputable.
 */
export function epley1Rm(weightKg, reps) {
  if (typeof weightKg !== 'number' || typeof reps !== 'number') return 0
  if (!(weightKg > 0) || !(reps > 0)) return 0
  return weightKg * (1 + reps / 30)
}

/**
 * Working volume of one set: weight times reps.
 * @param {{weight_kg: number|null, reps: number|null}} set - one Hevy set.
 * @returns {number} kilograms moved, 0 when the set is bodyweight or timed.
 */
export function setVolume(set) {
  const weight = set?.weight_kg
  const reps = set?.reps
  if (typeof weight !== 'number' || typeof reps !== 'number') return 0
  if (!(weight > 0) || !(reps > 0)) return 0
  return weight * reps
}

/**
 * Whether one set counts as working volume.
 * @param {{type?: string}} set - one Hevy set.
 * @returns {boolean} true unless the set is a warmup.
 */
function isWorkingSet(set) {
  return !NON_WORKING_SET_TYPES.has(set?.type ?? 'normal')
}

/**
 * Index exercise templates by id.
 * @param {object[]} templates - raw `/v1/exercise_templates` rows.
 * @returns {Map<string, object>} id to compact template.
 */
export function indexTemplates(templates) {
  const index = new Map()
  for (const template of templates ?? []) {
    if (typeof template?.id !== 'string') continue
    index.set(template.id, {
      title: template.title ?? '',
      primary: template.primary_muscle_group ?? 'other',
      secondary: Array.isArray(template.secondary_muscle_groups) ? template.secondary_muscle_groups : [],
      equipment: template.equipment ?? null,
      type: template.type ?? null,
    })
  }
  return index
}

/**
 * Working sets of one workout, flattened.
 * @param {object} workout - one raw Hevy workout.
 * @returns {Array<{exerciseTitle: string, templateId: string, set: object}>} working sets.
 */
function workingSetsOf(workout) {
  const rows = []
  for (const exercise of workout?.exercises ?? []) {
    for (const set of exercise?.sets ?? []) {
      if (!isWorkingSet(set)) continue
      rows.push({
        exerciseTitle: exercise.title ?? '',
        templateId: exercise.exercise_template_id ?? '',
        set,
      })
    }
  }
  return rows
}

/**
 * Duration of one workout in minutes.
 * @param {object} workout - one raw Hevy workout.
 * @returns {number} whole minutes, 0 when the session has no end time.
 */
function durationMinutes(workout) {
  const start = new Date(String(workout?.start_time ?? '')).getTime()
  const end = new Date(String(workout?.end_time ?? '')).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0
  return Math.round((end - start) / 60_000)
}

/**
 * Build the weekly training-load series.
 * @param {object[]} workouts - raw workouts, any order.
 * @param {number} weeks - bucket count, ending with the current week.
 * @param {string} timeZone - IANA zone name.
 * @param {Date} now - reference instant.
 * @returns {object[]} week buckets, oldest first.
 */
export function weeklySeries(workouts, weeks, timeZone, now) {
  const todayKey = dayKeyOf(now, timeZone)
  const todayNumber = todayKey === null ? 0 : dayNumberOf(todayKey)
  const currentWeekStart = weekStartOf(todayNumber)

  /** @type {Map<number, object>} */
  const buckets = new Map()
  for (let offset = weeks - 1; offset >= 0; offset -= 1) {
    const start = currentWeekStart - offset * 7
    buckets.set(start, {
      weekStart: dayKeyOfNumber(start),
      sessions: 0,
      volumeKg: 0,
      sets: 0,
      reps: 0,
      minutes: 0,
    })
  }

  for (const workout of workouts ?? []) {
    const key = dayKeyOf(workout?.start_time, timeZone)
    if (key === null) continue
    const bucket = buckets.get(weekStartOf(dayNumberOf(key)))
    if (bucket === undefined) continue
    bucket.sessions += 1
    bucket.minutes += durationMinutes(workout)
    for (const row of workingSetsOf(workout)) {
      bucket.sets += 1
      bucket.reps += typeof row.set.reps === 'number' ? row.set.reps : 0
      bucket.volumeKg += setVolume(row.set)
    }
  }

  return [...buckets.values()].map((bucket) => ({
    weekStart: bucket.weekStart,
    sessions: bucket.sessions,
    volumeKg: round(bucket.volumeKg),
    sets: bucket.sets,
    reps: bucket.reps,
    minutes: bucket.minutes,
  }))
}

/**
 * Muscle-group balance over a recency window.
 * @param {object[]} workouts - raw workouts.
 * @param {Map<string, object>} templates - template index.
 * @param {string} timeZone - IANA zone name.
 * @param {Date} now - reference instant.
 * @param {number} windowDays - look-back length in days.
 * @returns {{rows: object[], lastTrained: Record<string, string|null>}} balance rows and last-seen days.
 */
export function muscleBalance(workouts, templates, timeZone, now, windowDays) {
  const todayKey = dayKeyOf(now, timeZone)
  const todayNumber = todayKey === null ? 0 : dayNumberOf(todayKey)
  const windowStart = todayNumber - windowDays + 1

  /** @type {Map<string, {sets: number, volumeKg: number, sessions: Set<string>}>} */
  const totals = new Map()
  /** @type {Record<string, string>} */
  const lastTrained = {}

  for (const workout of workouts ?? []) {
    const key = dayKeyOf(workout?.start_time, timeZone)
    if (key === null) continue
    const dayNumber = dayNumberOf(key)
    const inWindow = dayNumber >= windowStart && dayNumber <= todayNumber
    const sessionId = String(workout?.id ?? key)

    for (const row of workingSetsOf(workout)) {
      const template = templates.get(row.templateId)
      const primary = template?.primary ?? 'other'
      const secondaries = template?.secondary ?? []

      /*
       * Every group the set actually worked counts as trained, secondaries
       * included. Recording only the primary left a secondary row that had
       * sets and volume but "last trained: —", which reads as never trained.
       */
      for (const group of [primary, ...secondaries]) {
        const seen = lastTrained[group]
        if (seen === undefined || seen === null || key > seen) lastTrained[group] = key
      }

      if (!inWindow) continue
      bump(primary, 1)
      for (const secondary of secondaries) bump(secondary, SECONDARY_MUSCLE_CREDIT)

      /**
       * Accumulate one muscle group's credit for the current set.
       * @param {string} group - muscle group name.
       * @param {number} credit - working-set credit.
       * @returns {void}
       */
      function bump(group, credit) {
        let entry = totals.get(group)
        if (entry === undefined) {
          entry = { sets: 0, volumeKg: 0, sessions: new Set() }
          totals.set(group, entry)
        }
        entry.sets += credit
        entry.sessions.add(sessionId)
      }
    }

    if (!inWindow) continue
    /*
     * Volume follows the same credit as the set count. Crediting a secondary
     * group 0.5 sets but 0 kg made a row read "5 sets · 0 kg", which looks like
     * a rendering bug rather than a deliberate weighting.
     */
    for (const row of workingSetsOf(workout)) {
      const volume = setVolume(row.set)
      if (volume <= 0) continue
      const template = templates.get(row.templateId)
      const primary = template?.primary ?? 'other'
      const entry = totals.get(primary)
      if (entry !== undefined) entry.volumeKg += volume
      for (const secondary of template?.secondary ?? []) {
        const secondaryEntry = totals.get(secondary)
        if (secondaryEntry !== undefined) secondaryEntry.volumeKg += volume * SECONDARY_MUSCLE_CREDIT
      }
    }
  }

  const rows = [...totals.entries()]
    .map(([group, entry]) => ({
      group,
      sets: round(entry.sets),
      volumeKg: round(entry.volumeKg),
      sessions: entry.sessions.size,
      lastTrained: lastTrained[group] ?? null,
    }))
    .sort((left, right) => {
      const leftRank = MUSCLE_ORDER.indexOf(left.group)
      const rightRank = MUSCLE_ORDER.indexOf(right.group)
      return (leftRank < 0 ? MUSCLE_ORDER.length : leftRank) - (rightRank < 0 ? MUSCLE_ORDER.length : rightRank)
    })

  return { rows, lastTrained }
}

/**
 * Per-lift progression across the whole history.
 * @param {object[]} workouts - raw workouts.
 * @param {Map<string, object>} templates - template index.
 * @param {string} timeZone - IANA zone name.
 * @param {Date} now - reference instant.
 * @returns {{lifts: object[], prs: object[]}} ranked lifts and fresh PRs.
 */
export function liftProgress(workouts, templates, timeZone, now) {
  const todayKey = dayKeyOf(now, timeZone)
  const todayNumber = todayKey === null ? 0 : dayNumberOf(todayKey)

  /** @type {Map<string, {title: string, bestE1rm: number, bestWeightKg: number, bestReps: number, bestAt: string, sessions: Map<string, number>, history: Array<{date: string, e1rm: number}>}>} */
  const lifts = new Map()

  for (const workout of workouts ?? []) {
    const key = dayKeyOf(workout?.start_time, timeZone)
    if (key === null) continue
    /** @type {Map<string, number>} best e1RM inside this session, per template */
    const sessionBest = new Map()

    for (const row of workingSetsOf(workout)) {
      const templateId = row.templateId
      if (templateId === '') continue
      const e1rm = epley1Rm(row.set.weight_kg, row.set.reps)
      if (e1rm <= 0) continue
      sessionBest.set(templateId, Math.max(sessionBest.get(templateId) ?? 0, e1rm))

      let entry = lifts.get(templateId)
      if (entry === undefined) {
        entry = {
          title: templates.get(templateId)?.title ?? row.exerciseTitle,
          bestE1rm: 0,
          bestWeightKg: 0,
          bestReps: 0,
          bestAt: key,
          sessions: new Map(),
          history: [],
        }
        lifts.set(templateId, entry)
      }
      entry.sessions.set(key, (entry.sessions.get(key) ?? 0) + 1)
      if (e1rm > entry.bestE1rm) {
        entry.bestE1rm = e1rm
        entry.bestWeightKg = row.set.weight_kg ?? 0
        entry.bestReps = row.set.reps ?? 0
        entry.bestAt = key
      }
    }

    for (const [templateId, e1rm] of sessionBest) {
      lifts.get(templateId)?.history.push({ date: key, e1rm: round(e1rm, 1) })
    }
  }

  const ranked = [...lifts.entries()]
    .map(([templateId, entry]) => {
      const history = entry.history.slice().sort((left, right) => left.date.localeCompare(right.date))
      const previousBest = history
        .slice(0, -1)
        .reduce((best, point) => Math.max(best, point.e1rm), 0)
      return {
        templateId,
        title: entry.title,
        bestE1rm: round(entry.bestE1rm, 1),
        bestWeightKg: entry.bestWeightKg,
        bestReps: entry.bestReps,
        bestAt: entry.bestAt,
        sessions: entry.sessions.size,
        history,
        previousBestE1rm: round(previousBest, 1),
      }
    })
    .sort((left, right) => right.bestE1rm - left.bestE1rm)

  const prs = ranked
    .filter((lift) => {
      if (lift.sessions < 2) return false
      if (lift.bestE1rm <= lift.previousBestE1rm) return false
      return todayNumber - dayNumberOf(lift.bestAt) <= PR_WINDOW_DAYS
    })
    .map((lift) => ({
      templateId: lift.templateId,
      title: lift.title,
      e1rm: lift.bestE1rm,
      previousE1rm: lift.previousBestE1rm,
      weightKg: lift.bestWeightKg,
      reps: lift.bestReps,
      date: lift.bestAt,
    }))

  return { lifts: ranked, prs }
}

/**
 * Recent sessions with full set detail.
 * @param {object[]} workouts - raw workouts.
 * @param {string} timeZone - IANA zone name.
 * @param {number} limit - how many sessions to keep.
 * @returns {object[]} newest-first compact sessions.
 */
export function recentSessions(workouts, timeZone, limit) {
  return [...(workouts ?? [])]
    .filter((workout) => typeof workout?.start_time === 'string')
    .sort((left, right) => String(right.start_time).localeCompare(String(left.start_time)))
    .slice(0, limit)
    .map((workout) => {
      const sets = workingSetsOf(workout)
      return {
        id: workout.id ?? null,
        title: workout.title ?? '',
        date: dayKeyOf(workout.start_time, timeZone),
        startTime: workout.start_time ?? null,
        minutes: durationMinutes(workout),
        volumeKg: round(sets.reduce((sum, row) => sum + setVolume(row.set), 0)),
        sets: sets.length,
        reps: sets.reduce((sum, row) => sum + (typeof row.set.reps === 'number' ? row.set.reps : 0), 0),
        exercises: (workout.exercises ?? []).map((exercise) => ({
          title: exercise.title ?? '',
          notes: exercise.notes ?? null,
          templateId: exercise.exercise_template_id ?? null,
          sets: (exercise.sets ?? []).map((set) => ({
            type: set.type ?? 'normal',
            weightKg: set.weight_kg ?? null,
            reps: set.reps ?? null,
            durationSeconds: set.duration_seconds ?? null,
            distanceMeters: set.distance_meters ?? null,
            rpe: set.rpe ?? null,
          })),
        })),
      }
    })
}

/**
 * Body-weight trend from dated measurements.
 * @param {object[]} measurements - raw `/v1/body_measurements` rows.
 * @returns {{series: object[], latest: object|null, deltaKg: number|null}} oldest-first series.
 */
export function weightTrend(measurements) {
  /*
   * One reading per date. The API can return two entries for the same day (a
   * re-scan, or a weight-only follow-up); keeping both invents a step change
   * inside a single day and makes the reported delta meaningless. The later
   * entry wins, since that is the one written last.
   */
  const byDate = new Map()
  for (const row of measurements ?? []) {
    if (typeof row?.date !== 'string' || typeof row?.weight_kg !== 'number') continue
    byDate.set(row.date, {
      date: row.date,
      weightKg: row.weight_kg,
      fatPercent: typeof row.fat_percent === 'number' ? row.fat_percent : null,
      leanMassKg: typeof row.lean_mass_kg === 'number' ? row.lean_mass_kg : null,
    })
  }
  const series = [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date))

  const latest = series.at(-1) ?? null
  const previous = series.at(-2) ?? null
  const deltaKg = latest !== null && previous !== null ? round(latest.weightKg - previous.weightKg, 1) : null
  return { series, latest, deltaKg }
}

/**
 * Whether a body-weight reading is still fresh enough to read as a trend.
 * @param {{date: string}|null} latest - newest measurement, or null.
 * @param {string} timeZone - IANA zone name.
 * @param {Date} now - reference instant.
 * @param {number} staleAfterDays - age at which a reading stops being current.
 * @returns {{daysSince: number|null, stale: boolean, staleAfterDays: number}} freshness facts.
 */
export function weightFreshness(latest, timeZone, now, staleAfterDays = WEIGHT_STALE_AFTER_DAYS) {
  const todayKey = dayKeyOf(now, timeZone)
  if (latest === null || latest === undefined || todayKey === null) {
    return { daysSince: null, stale: false, staleAfterDays }
  }
  const daysSince = dayNumberOf(todayKey) - dayNumberOf(latest.date)
  return { daysSince, stale: daysSince > staleAfterDays, staleAfterDays }
}

/**
 * Per-set intensity proxy used to detect a collapse inside one exercise.
 *
 * Loaded sets score by estimated 1RM so a weight drop and a rep drop both
 * count; unloaded sets fall back to raw reps, because bodyweight work carries
 * no weight yet still collapses — which is the case the journal's
 * "reps collapse → end the exercise" rule is written for.
 *
 * @param {object} set - one Hevy set.
 * @returns {number} comparable intensity, 0 when the set is unusable.
 */
function intensityOf(set) {
  const e1rm = epley1Rm(set?.weight_kg, set?.reps)
  if (e1rm > 0) return e1rm
  const reps = set?.reps
  return typeof reps === 'number' && reps > 0 ? reps : 0
}

/**
 * Session quality over a recency window.
 *
 * Three signals the journal judges progress by but no load metric captures:
 * how far the last set of an exercise falls below its best set in the same
 * session (the 40–50% collapse that ended the 2026-10-20 block), how many sets
 * were taken to failure, and how much of the work carries an RPE at all —
 * without RPE there is no way to apply "six weeks without failure, then 7 → 8".
 *
 * @param {object[]} workouts - raw workouts.
 * @param {string} timeZone - IANA zone name.
 * @param {Date} now - reference instant.
 * @param {number} windowDays - look-back length in days.
 * @returns {object} quality facts plus a per-session breakdown, newest first.
 */
export function sessionQuality(workouts, timeZone, now, windowDays = QUALITY_WINDOW_DAYS) {
  const todayKey = dayKeyOf(now, timeZone)
  const todayNumber = todayKey === null ? 0 : dayNumberOf(todayKey)
  const windowStart = todayNumber - windowDays + 1

  const sessions = []
  let workingSets = 0
  let failureSets = 0
  let dropsetSets = 0
  let rpeSets = 0
  let lastFailureAt = null

  for (const workout of workouts ?? []) {
    const key = dayKeyOf(workout?.start_time, timeZone)
    if (key === null) continue
    const dayNumber = dayNumberOf(key)
    if (dayNumber < windowStart || dayNumber > todayNumber) continue

    let sessionWorking = 0
    let sessionFailure = 0
    let sessionDropset = 0
    let sessionRpe = 0
    let sessionDropoff = 0
    let sessionDropoffExercise = null
    /* A tracked flag, not `exercise === null`: a measured drop of exactly zero is a result. */
    let sessionMeasured = false

    for (const exercise of workout?.exercises ?? []) {
      const scored = []
      for (const set of exercise?.sets ?? []) {
        if (!isWorkingSet(set)) continue
        sessionWorking += 1
        if (set.type === 'failure') sessionFailure += 1
        if (set.type === 'dropset') sessionDropset += 1
        if (typeof set.rpe === 'number' && set.rpe > 0) sessionRpe += 1
        const intensity = intensityOf(set)
        if (intensity > 0) scored.push(intensity)
      }

      /*
       * A drop-off needs two scored sets to compare. The last set is what
       * matters: it says whether the exercise was still worth continuing.
       */
      if (scored.length < 2) continue
      const best = Math.max(...scored)
      const last = scored.at(-1)
      if (best <= 0) continue
      sessionMeasured = true
      const dropoff = ((best - last) / best) * 100
      if (dropoff > sessionDropoff || sessionDropoffExercise === null) {
        sessionDropoff = Math.max(sessionDropoff, dropoff)
        sessionDropoffExercise = exercise?.title ?? null
      }
    }

    workingSets += sessionWorking
    failureSets += sessionFailure
    dropsetSets += sessionDropset
    rpeSets += sessionRpe
    if (sessionFailure > 0 && (lastFailureAt === null || key > lastFailureAt)) lastFailureAt = key

    sessions.push({
      id: workout?.id ?? null,
      title: workout?.title ?? '',
      date: key,
      workingSets: sessionWorking,
      failureSets: sessionFailure,
      dropsetSets: sessionDropset,
      rpeSets: sessionRpe,
      /* Null means no exercise had two comparable sets — not the same as a measured zero. */
      dropoffPct: sessionMeasured ? round(sessionDropoff, 1) : null,
      dropoffExercise: sessionDropoffExercise,
      /* The journal's rule, made visible: did any exercise collapse this session. */
      collapsed: sessionDropoff >= DROPOFF_ALERT_PCT,
    })
  }

  sessions.sort((left, right) => String(right.date).localeCompare(String(left.date)) || 0)

  const measured = sessions.filter((session) => session.dropoffPct !== null)
  const average = measured.length === 0
    ? null
    : round(measured.reduce((sum, session) => sum + session.dropoffPct, 0) / measured.length, 1)
  const worst = measured.reduce(
    (top, session) => (top === null || session.dropoffPct > top.dropoffPct ? session : top),
    null,
  )

  return {
    windowDays,
    sessions,
    workingSets,
    failureSets,
    dropsetSets,
    rpeSets,
    /* Share of working sets carrying an RPE; 0 when nothing is logged. */
    rpeCoverage: workingSets === 0 ? 0 : round(rpeSets / workingSets, 2),
    averageDropoffPct: average,
    worstDropoffPct: worst === null ? null : worst.dropoffPct,
    worstDropoffExercise: worst === null ? null : worst.dropoffExercise,
    worstDropoffDate: worst === null ? null : worst.date,
    collapsedSessions: sessions.filter((session) => session.collapsed).length,
    lastFailureAt,
    daysSinceFailure: lastFailureAt === null ? null : todayNumber - dayNumberOf(lastFailureAt),
    collapseAlertPct: DROPOFF_ALERT_PCT,
  }
}

/**
 * Free-text notes attached to sessions, newest first.
 *
 * `workout.description` and per-exercise `notes` are the only place the *why*
 * of a session lives — the journal's "don't substitute silently" rule depends
 * on them. They are unstructured and cannot be aggregated, but they must be
 * reachable without opening every session one at a time.
 *
 * @param {object[]} workouts - raw workouts.
 * @param {string} timeZone - IANA zone name.
 * @param {number} limit - maximum annotated sessions to keep.
 * @returns {object[]} entries carrying at least one non-empty note.
 */
export function sessionNotes(workouts, timeZone, limit = 12) {
  return [...(workouts ?? [])]
    .filter((workout) => typeof workout?.start_time === 'string')
    .sort((left, right) => String(right.start_time).localeCompare(String(left.start_time)))
    .map((workout) => {
      const text = (value) => (typeof value === 'string' ? value.trim() : '')
      const exerciseNotes = (workout?.exercises ?? [])
        .map((exercise) => ({ title: exercise?.title ?? '', notes: text(exercise?.notes) }))
        .filter((exercise) => exercise.notes !== '')
      return {
        id: workout?.id ?? null,
        title: workout?.title ?? '',
        date: dayKeyOf(workout.start_time, timeZone),
        note: text(workout?.description),
        exerciseNotes,
      }
    })
    .filter((entry) => entry.note !== '' || entry.exerciseNotes.length > 0)
    .slice(0, limit)
}

/**
 * Weekly consistency over the trailing window.
 *
 * The last bucket is the week in progress, so it is never allowed to break a
 * streak: an athlete who trained Monday through last week and has not trained
 * again by Tuesday morning has a streak, not a reset. The in-progress week is
 * reported separately instead of being folded into the count.
 *
 * @param {object[]} weeks - weekly buckets, oldest first; the last one is current.
 * @param {number} window - weeks to consider from the end.
 * @returns {{activeWeeks: number, window: number, streak: number, averageSessions: number, currentWeekSessions: number}} consistency facts.
 */
export function consistency(weeks, window) {
  const tail = weeks.slice(-window)
  const active = tail.filter((week) => week.sessions > 0)
  const currentWeekSessions = tail.at(-1)?.sessions ?? 0

  let streak = 0
  for (let index = weeks.length - 1; index >= 0; index -= 1) {
    const isCurrentWeek = index === weeks.length - 1
    if (weeks[index].sessions === 0) {
      /* Not trained yet this week is not a broken streak. */
      if (isCurrentWeek) continue
      break
    }
    streak += 1
  }

  const sessions = tail.reduce((sum, week) => sum + week.sessions, 0)
  return {
    activeWeeks: active.length,
    window: tail.length,
    streak,
    averageSessions: tail.length === 0 ? 0 : round(sessions / tail.length, 2),
    currentWeekSessions,
  }
}

/**
 * Assemble the whole panel payload.
 * @param {object} input - aggregation input.
 * @param {object[]} input.workouts - raw workouts.
 * @param {object[]} input.measurements - raw body measurements.
 * @param {object[]} input.templates - raw exercise templates.
 * @param {object|null} input.user - `/v1/user/info` payload.
 * @param {number} input.weeks - weekly bucket count.
 * @param {number} input.muscleWindowDays - muscle-balance window.
 * @param {string} input.timeZone - IANA zone name.
 * @param {Date} input.now - reference instant.
 * @returns {object} panel payload.
 */
export function buildOverview(input) {
  const {
    workouts, measurements, templates, user, weeks, muscleWindowDays,
    qualityWindowDays = QUALITY_WINDOW_DAYS, timeZone, now,
  } = input
  const templateIndex = indexTemplates(templates)
  const series = weeklySeries(workouts, weeks, timeZone, now)
  const balance = muscleBalance(workouts, templateIndex, timeZone, now, muscleWindowDays)
  const progress = liftProgress(workouts, templateIndex, timeZone, now)
  const weight = weightTrend(measurements)
  const quality = sessionQuality(workouts, timeZone, now, qualityWindowDays)

  const todayKey = dayKeyOf(now, timeZone)
  const todayNumber = todayKey === null ? 0 : dayNumberOf(todayKey)
  const stale = balance.rows
    .filter((row) => {
      if (row.lastTrained === null) return false
      return todayNumber - dayNumberOf(row.lastTrained) > STALE_AFTER_DAYS
    })
    .map((row) => ({ group: row.group, lastTrained: row.lastTrained }))

  /*
   * The newest session regardless of window. A lapsed athlete's 12-week series
   * is legitimately all zeros, and a panel that renders nothing but zeroes
   * reads as broken rather than as "you have not trained since July" — the
   * client needs this to say which it is.
   */
  const allSessions = recentSessions(workouts, timeZone, 1)
  const lastSession = allSessions[0] === undefined
    ? null
    : { id: allSessions[0].id, title: allSessions[0].title, date: allSessions[0].date }

  const totals = {
    workouts: (workouts ?? []).length,
    sessions: series.reduce((sum, week) => sum + week.sessions, 0),
    volumeKg: round(series.reduce((sum, week) => sum + week.volumeKg, 0)),
    sets: series.reduce((sum, week) => sum + week.sets, 0),
    reps: series.reduce((sum, week) => sum + week.reps, 0),
    minutes: series.reduce((sum, week) => sum + week.minutes, 0),
  }

  return {
    generatedAt: now.toISOString(),
    timeZone,
    weeks,
    muscleWindowDays,
    user: user === null || user === undefined
      ? null
      : {
          username: user.username ?? null,
          name: user.name ?? null,
          url: user.url ?? null,
          weightUnit: user.weight_unit ?? 'kg',
          isPro: user.is_pro === true,
        },
    totals,
    lastSession,
    weeksSeries: series,
    consistency: consistency(series, Math.min(4, series.length)),
    muscles: balance.rows,
    staleMuscles: stale,
    weight,
    weightFreshness: weightFreshness(weight.latest, timeZone, now),
    lifts: progress.lifts.slice(0, 12),
    prs: progress.prs,
    quality,
    notes: sessionNotes(workouts, timeZone, 12),
    recent: recentSessions(workouts, timeZone, 12),
  }
}

/**
 * Version of the `/snapshot` document shape.
 *
 * Bump on any rename or semantic change that would make two snapshots
 * incomparable. The whole point of the document is that a later turn can diff
 * it against an earlier one, and a silent field rename would quietly turn
 * "volume fell 40%" into "volume disappeared" — a wrong conclusion drawn with
 * full confidence.
 */
export const SNAPSHOT_SCHEMA_VERSION = 1

/** RPE must cover at least this share of working sets before it can drive load. */
const RPE_COVERAGE_FLOOR = 0.5

/** Notes carried inside one snapshot document; `/overview` carries more. */
const SNAPSHOT_NOTE_LIMIT = 5

/**
 * Read a dotted path, tolerating missing intermediate objects.
 * @param {object|null} object - document root.
 * @param {string} path - dot-separated keys.
 * @returns {unknown} value, or null when the path does not resolve.
 */
function readPath(object, path) {
  let cursor = object
  for (const part of path.split('.')) {
    if (cursor === null || cursor === undefined || typeof cursor !== 'object') return null
    cursor = cursor[part]
  }
  return cursor === undefined ? null : cursor
}

/**
 * Format one number for a markdown table.
 * @param {unknown} value - candidate.
 * @returns {string} display text.
 */
function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  if (typeof value !== 'number') return String(value)
  if (Number.isInteger(value)) return value.toLocaleString('en-US')
  return value.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

/**
 * A signed delta for a markdown table.
 * @param {number|null} value - delta.
 * @returns {string} display text.
 */
function formatDelta(value) {
  if (value === null || value === undefined) return '—'
  const text = formatNumber(Math.abs(value))
  if (value === 0) return '0'
  return `${value > 0 ? '+' : '−'}${text}`
}

/**
 * Build the machine-readable snapshot document.
 *
 * This is `/overview` reshaped for a reader that is not a browser: flat
 * scalars instead of nested presentation objects, stable ordering everywhere,
 * no set-level detail, and an explicit `flags` vocabulary. Two snapshots taken
 * a week apart should diff into a short list of changed numbers rather than a
 * structural puzzle, which is why the muscle table always carries all 21
 * groups (a zero is a fact, not an absence) and why lifts are ordered by
 * `templateId` rather than by rank.
 *
 * @param {object} input - same input as {@link buildOverview}.
 * @returns {object} snapshot document.
 */
export function buildSnapshot(input) {
  const {
    workouts, measurements, templates, user,
    weeks = 12,
    muscleWindowDays = 28,
    qualityWindowDays = QUALITY_WINDOW_DAYS,
    timeZone, now,
  } = input

  const templateIndex = indexTemplates(templates)
  const series = weeklySeries(workouts, weeks, timeZone, now)
  const balance = muscleBalance(workouts, templateIndex, timeZone, now, muscleWindowDays)
  const progress = liftProgress(workouts, templateIndex, timeZone, now)
  const weight = weightTrend(measurements)
  const freshness = weightFreshness(weight.latest, timeZone, now)
  const quality = sessionQuality(workouts, timeZone, now, qualityWindowDays)
  const streakFacts = consistency(series, Math.min(4, series.length))

  const asOf = dayKeyOf(now, timeZone)
  const todayNumber = asOf === null ? 0 : dayNumberOf(asOf)

  const blank = { weekStart: null, sessions: 0, volumeKg: 0, sets: 0, reps: 0, minutes: 0 }
  /** Copy only the six bucketed facts, so the document has one week shape. */
  const weekOf = (bucket) => ({
    weekStart: bucket.weekStart,
    sessions: bucket.sessions,
    volumeKg: bucket.volumeKg,
    sets: bucket.sets,
    reps: bucket.reps,
    minutes: bucket.minutes,
  })
  const week = weekOf(series.at(-1) ?? blank)
  const previousWeek = weekOf(series.length > 1 ? series.at(-2) : blank)

  /*
   * Every muscle group, always. A group that went from 12 sets to 0 is the
   * single most important thing a week-over-week diff can show, and it can
   * only show up if the row exists in both documents.
   */
  const byGroup = new Map(balance.rows.map((row) => [row.group, row]))
  const muscles = MUSCLE_ORDER.map((group) => {
    const row = byGroup.get(group)
    const lastTrained = row?.lastTrained ?? balance.lastTrained[group] ?? null
    return {
      group,
      sets: row?.sets ?? 0,
      volumeKg: row?.volumeKg ?? 0,
      sessions: row?.sessions ?? 0,
      lastTrained,
      daysSince: lastTrained === null ? null : todayNumber - dayNumberOf(lastTrained),
    }
  })

  const staleMuscles = muscles
    .filter((row) => row.daysSince !== null && row.daysSince > STALE_AFTER_DAYS)
    .map((row) => row.group)

  const lifts = progress.lifts
    .slice()
    .sort((left, right) => left.templateId.localeCompare(right.templateId))
    .map((lift) => ({
      templateId: lift.templateId,
      title: lift.title,
      bestE1rm: lift.bestE1rm,
      bestWeightKg: lift.bestWeightKg,
      bestReps: lift.bestReps,
      bestAt: lift.bestAt,
      sessions: lift.sessions,
      previousBestE1rm: lift.previousBestE1rm,
    }))

  const prs = progress.prs.map((pr) => ({
    templateId: pr.templateId,
    title: pr.title,
    e1rm: pr.e1rm,
    previousE1rm: pr.previousE1rm,
    weightKg: pr.weightKg,
    reps: pr.reps,
    date: pr.date,
  }))

  /*
   * The attention list. A fixed vocabulary beats prose here: an agent turn can
   * compare this array against the previous one and act on what appeared,
   * without re-deriving thresholds from raw numbers every week.
   */
  /*
   * `streak:broken` needs a streak to have existed. A lifter in their first
   * weeks has logged nothing and has not "broken" anything — `week:empty`
   * already says the useful thing, and a permanent warning on a new account
   * trains the reader to ignore the whole list.
   */
  const windowSessions = series.reduce((sum, bucket) => sum + bucket.sessions, 0)

  const flags = []
  if (week.sessions === 0) flags.push('week:empty')
  if (windowSessions > 0 && series.length > 1 && streakFacts.streak === 0) flags.push('streak:broken')
  if (weight.latest === null) flags.push('weight:none')
  else if (freshness.stale) flags.push('weight:stale')
  if (quality.collapsedSessions > 0) flags.push('quality:collapse')
  if (quality.workingSets > 0 && quality.rpeCoverage < RPE_COVERAGE_FLOOR) flags.push('quality:rpe-thin')
  if (
    quality.workingSets > 0
    && (quality.daysSinceFailure === null || quality.daysSinceFailure >= QUALITY_WINDOW_DAYS)
  ) {
    flags.push('progression:failure-free')
  }
  for (const group of staleMuscles) flags.push(`muscle-stale:${group}`)
  flags.sort()

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    asOf,
    timeZone,
    window: {
      weeks,
      muscleWindowDays,
      qualityWindowDays,
      from: series[0]?.weekStart ?? null,
      to: asOf,
    },
    athlete: user === null || user === undefined
      ? null
      : {
          username: user.username ?? null,
          name: user.name ?? null,
          weightUnit: user.weight_unit ?? 'kg',
          isPro: user.is_pro === true,
        },
    week,
    previousWeek,
    totals: {
      sessions: windowSessions,
      volumeKg: round(series.reduce((sum, bucket) => sum + bucket.volumeKg, 0)),
      sets: series.reduce((sum, bucket) => sum + bucket.sets, 0),
      reps: series.reduce((sum, bucket) => sum + bucket.reps, 0),
      minutes: series.reduce((sum, bucket) => sum + bucket.minutes, 0),
    },
    consistency: {
      streak: streakFacts.streak,
      activeWeeks: streakFacts.activeWeeks,
      window: streakFacts.window,
      averageSessions: streakFacts.averageSessions,
      currentWeekSessions: streakFacts.currentWeekSessions,
    },
    muscles,
    staleMuscles,
    weight: {
      latestDate: weight.latest?.date ?? null,
      latestKg: weight.latest?.weightKg ?? null,
      fatPercent: weight.latest?.fatPercent ?? null,
      leanMassKg: weight.latest?.leanMassKg ?? null,
      previousKg: weight.series.length > 1 ? weight.series.at(-2).weightKg : null,
      deltaKg: weight.deltaKg,
      readings: weight.series.length,
      daysSince: freshness.daysSince,
      stale: freshness.stale,
    },
    lifts,
    prs,
    quality: {
      windowDays: quality.windowDays,
      workingSets: quality.workingSets,
      failureSets: quality.failureSets,
      dropsetSets: quality.dropsetSets,
      rpeSets: quality.rpeSets,
      rpeCoverage: quality.rpeCoverage,
      averageDropoffPct: quality.averageDropoffPct,
      worstDropoffPct: quality.worstDropoffPct,
      worstDropoffExercise: quality.worstDropoffExercise,
      worstDropoffDate: quality.worstDropoffDate,
      collapsedSessions: quality.collapsedSessions,
      lastFailureAt: quality.lastFailureAt,
      daysSinceFailure: quality.daysSinceFailure,
      collapseAlertPct: quality.collapseAlertPct,
    },
    notes: sessionNotes(workouts, timeZone, SNAPSHOT_NOTE_LIMIT),
    flags,
  }
}

/** Scalars compared by {@link diffSnapshots}, with the label used in reports. */
const DIFF_METRICS = [
  ['week.sessions', 'sessions this week'],
  ['week.volumeKg', 'volume this week (kg)'],
  ['week.sets', 'sets this week'],
  ['week.minutes', 'minutes this week'],
  ['totals.sessions', 'sessions in window'],
  ['totals.volumeKg', 'volume in window (kg)'],
  ['consistency.streak', 'week streak'],
  ['consistency.averageSessions', 'sessions per week'],
  ['weight.latestKg', 'body weight (kg)'],
  ['weight.daysSince', 'days since weigh-in'],
  ['quality.worstDropoffPct', 'worst drop-off (%)'],
  ['quality.rpeCoverage', 'RPE coverage'],
  ['quality.failureSets', 'failure sets'],
  ['quality.daysSinceFailure', 'days since last failure set'],
]

/**
 * Compare two snapshot documents.
 *
 * Returns `comparable: false` rather than guessing when the documents come
 * from different schema versions or when one is missing — a diff across a
 * schema change is worse than no diff, because it looks like data.
 *
 * Only changed scalars are listed; the unchanged ones are counted, so a caller
 * can tell "stable" from "not measured".
 *
 * @param {object|null} previous - earlier snapshot document.
 * @param {object|null} current - later snapshot document.
 * @returns {object} diff report.
 */
export function diffSnapshots(previous, current) {
  const report = {
    comparable: false,
    reason: null,
    previousAt: previous?.generatedAt ?? null,
    currentAt: current?.generatedAt ?? null,
    daysBetween: null,
    changes: [],
    unchanged: 0,
    flagsAdded: [],
    flagsCleared: [],
    newPrs: [],
    newNotes: [],
  }

  if (previous === null || previous === undefined || typeof previous !== 'object') {
    report.reason = 'no previous snapshot'
    return report
  }
  if (current === null || current === undefined || typeof current !== 'object') {
    report.reason = 'no current snapshot'
    return report
  }
  if (previous.schemaVersion !== current.schemaVersion) {
    report.reason = `schemaVersion ${previous.schemaVersion} → ${current.schemaVersion}`
    return report
  }

  if (report.previousAt !== null && report.currentAt !== null) {
    const elapsed = Date.parse(report.currentAt) - Date.parse(report.previousAt)
    if (Number.isFinite(elapsed)) report.daysBetween = round(elapsed / DAY_MS, 1)
  }

  const compare = (path, label, before, after) => {
    if (before === after) {
      report.unchanged += 1
      return
    }
    const bothNumbers = typeof before === 'number' && typeof after === 'number'
    report.changes.push({
      metric: path,
      label,
      before,
      after,
      delta: bothNumbers ? round(after - before, 2) : null,
      deltaPct: bothNumbers && before !== 0 ? round(((after - before) / Math.abs(before)) * 100, 1) : null,
    })
  }

  for (const [path, label] of DIFF_METRICS) {
    compare(path, label, readPath(previous, path), readPath(current, path))
  }
  for (const group of MUSCLE_ORDER) {
    const setsOf = (snapshot) => snapshot.muscles?.find((row) => row.group === group)?.sets ?? 0
    compare(`muscles.${group}.sets`, `${group} sets`, setsOf(previous), setsOf(current))
  }

  const beforeFlags = new Set(previous.flags ?? [])
  const afterFlags = new Set(current.flags ?? [])
  report.flagsAdded = [...afterFlags].filter((flag) => !beforeFlags.has(flag)).sort()
  report.flagsCleared = [...beforeFlags].filter((flag) => !afterFlags.has(flag)).sort()

  const prKey = (pr) => `${pr.templateId}|${pr.date}`
  const knownPrs = new Set((previous.prs ?? []).map(prKey))
  report.newPrs = (current.prs ?? []).filter((pr) => !knownPrs.has(prKey(pr)))

  const knownNotes = new Set((previous.notes ?? []).map((note) => String(note.id ?? note.date)))
  report.newNotes = (current.notes ?? [])
    .filter((note) => !knownNotes.has(String(note.id ?? note.date)))

  report.comparable = true
  return report
}

/**
 * Render a snapshot as a short markdown brief.
 *
 * Two audiences, one document: a human skimming the week, and an agent that
 * wants the prose facts without parsing JSON. The machine-readable form is
 * still `/snapshot` — this one is for reading.
 *
 * @param {object} snapshot - snapshot document.
 * @param {object|null} previous - optional earlier snapshot to diff against.
 * @returns {string} markdown, ending with a newline.
 */
export function digestMarkdown(snapshot, previous = null) {
  const lines = []
  const week = snapshot.week ?? {}
  const prior = snapshot.previousWeek ?? {}
  const weight = snapshot.weight ?? {}
  const quality = snapshot.quality ?? {}
  const flags = snapshot.flags ?? []
  const diff = previous === null ? null : diffSnapshots(previous, snapshot)

  lines.push(`# Training digest — week of ${week.weekStart ?? '—'}`, '')

  const windowText = snapshot.window === undefined
    ? ''
    : ` · window ${snapshot.window.weeks}w (${snapshot.window.from ?? '—'} → ${snapshot.window.to ?? '—'})`
  const who = snapshot.athlete?.username ?? snapshot.athlete?.name ?? 'athlete'
  lines.push(
    `${who} · generated ${snapshot.generatedAt} · schema v${snapshot.schemaVersion} · ${snapshot.timeZone}${windowText}`,
    '',
  )

  lines.push('## This week', '')
  lines.push('| metric | this week | last week | change |')
  lines.push('| --- | ---: | ---: | ---: |')
  const row = (label, current, before) => {
    const delta = typeof current === 'number' && typeof before === 'number' ? current - before : null
    lines.push(`| ${label} | ${formatNumber(current)} | ${formatNumber(before)} | ${formatDelta(delta === null ? null : round(delta, 1))} |`)
  }
  row('sessions', week.sessions, prior.sessions)
  row('volume (kg)', week.volumeKg, prior.volumeKg)
  row('sets', week.sets, prior.sets)
  row('minutes', week.minutes, prior.minutes)
  lines.push('')

  lines.push('## Needs attention', '')
  if (flags.length === 0) {
    lines.push('- Nothing flagged this week.', '')
  } else {
    for (const flag of flags) {
      if (flag === 'week:empty') lines.push('- No session logged yet this week.')
      else if (flag === 'streak:broken') lines.push('- The last completed week had no session; the streak is broken.')
      else if (flag === 'weight:none') lines.push('- No body-weight measurement on record.')
      else if (flag === 'weight:stale') lines.push(`- Last body-weight reading is ${formatNumber(weight.daysSince)} days old.`)
      else if (flag === 'quality:collapse') lines.push(`- ${formatNumber(quality.collapsedSessions)} session(s) ended with a ≥${formatNumber(quality.collapseAlertPct)}% within-exercise drop-off.`)
      else if (flag === 'quality:rpe-thin') lines.push(`- RPE covers only ${formatNumber(Math.round((quality.rpeCoverage ?? 0) * 100))}% of working sets.`)
      else if (flag === 'progression:failure-free') lines.push(`- No failure set within ${formatNumber(quality.windowDays)} days; the journal's rule says add load and move RPE 7 → 8.`)
      else if (flag.startsWith('muscle-stale:')) {
        const group = flag.slice('muscle-stale:'.length)
        const daysSince = snapshot.muscles?.find((entry) => entry.group === group)?.daysSince
        lines.push(`- ${group} has not been trained in ${formatNumber(daysSince)} days.`)
      } else lines.push(`- ${flag}`)
    }
    lines.push('')
  }

  lines.push('## Consistency', '')
  const consistencyFacts = snapshot.consistency ?? {}
  lines.push(
    `Streak ${formatNumber(consistencyFacts.streak)} week(s) · `
    + `${formatNumber(consistencyFacts.averageSessions)} sessions/week average · `
    + `${formatNumber(snapshot.totals?.sessions)} session(s) and `
    + `${formatNumber(snapshot.totals?.volumeKg)} kg in the window.`,
    '',
  )

  const trained = (snapshot.muscles ?? []).filter((entry) => (entry.sets ?? 0) > 0)
  lines.push(`## Muscle balance (last ${snapshot.window?.muscleWindowDays ?? '—'} days)`, '')
  if (trained.length === 0) {
    lines.push('- Nothing logged in the window.', '')
  } else {
    lines.push('| group | sets | volume (kg) | sessions | last trained |')
    lines.push('| --- | ---: | ---: | ---: | --- |')
    for (const entry of trained) {
      lines.push(
        `| ${entry.group} | ${formatNumber(entry.sets)} | ${formatNumber(entry.volumeKg)} | `
        + `${formatNumber(entry.sessions)} | ${entry.lastTrained ?? '—'} |`,
      )
    }
    lines.push('')
  }

  lines.push('## Body weight', '')
  if (weight.latestKg === null || weight.latestKg === undefined) {
    lines.push('- No measurement recorded.', '')
  } else {
    lines.push(
      `- Latest ${formatNumber(weight.latestKg)} kg on ${weight.latestDate}`
      + ` (${formatNumber(weight.daysSince)} days ago)`
      + (weight.deltaKg === null ? '' : `, previous ${formatNumber(weight.previousKg)} kg (${formatDelta(weight.deltaKg)} kg)`)
      + `.`,
      '',
    )
  }

  const lifts = [...(snapshot.lifts ?? [])].sort((left, right) => right.bestE1rm - left.bestE1rm).slice(0, 8)
  lines.push('## Lifts (best e1RM, all history)', '')
  if (lifts.length === 0) {
    lines.push('- No loaded sets on record.', '')
  } else {
    lines.push('| lift | e1RM (kg) | best set | last |')
    lines.push('| --- | ---: | --- | --- |')
    for (const lift of lifts) {
      lines.push(
        `| ${lift.title} | ${formatNumber(lift.bestE1rm)} | `
        + `${formatNumber(lift.bestWeightKg)} kg × ${formatNumber(lift.bestReps)} | ${lift.bestAt} |`,
      )
    }
    lines.push('')
  }

  if ((snapshot.prs ?? []).length > 0) {
    lines.push('## Recent PRs', '')
    for (const pr of snapshot.prs) {
      lines.push(`- ${pr.date} — ${pr.title}: e1RM ${formatNumber(pr.e1rm)} kg (was ${formatNumber(pr.previousE1rm)})`)
    }
    lines.push('')
  }

  if ((snapshot.notes ?? []).length > 0) {
    lines.push('## Notes', '')
    for (const note of snapshot.notes) {
      const head = `${note.date ?? '—'} — ${note.title || 'session'}`
      lines.push(`- **${head}**${note.note === '' ? '' : `: ${note.note}`}`)
      for (const exercise of note.exerciseNotes ?? []) {
        lines.push(`  - ${exercise.title}: ${exercise.notes}`)
      }
    }
    lines.push('')
  }

  if (diff !== null) {
    lines.push(`## Against the previous snapshot (${diff.previousAt ?? '—'})`, '')
    if (!diff.comparable) {
      lines.push(`- Not comparable: ${diff.reason}.`, '')
    } else {
      if (diff.daysBetween !== null) lines.push(`- ${formatNumber(diff.daysBetween)} day(s) apart.`)
      if (diff.changes.length === 0) {
        lines.push(`- No changed metric (${formatNumber(diff.unchanged)} compared).`)
      } else {
        for (const change of diff.changes) {
          const pct = change.deltaPct === null ? '' : ` (${formatDelta(change.deltaPct)}%)`
          lines.push(`- ${change.label}: ${formatNumber(change.before)} → ${formatNumber(change.after)}${pct}`)
        }
      }
      for (const flag of diff.flagsAdded) lines.push(`- New flag: \`${flag}\``)
      for (const flag of diff.flagsCleared) lines.push(`- Cleared flag: \`${flag}\``)
      for (const pr of diff.newPrs) lines.push(`- New PR: ${pr.title} at e1RM ${formatNumber(pr.e1rm)} kg`)
      lines.push('')
    }
  }

  return `${lines.join('\n')}\n`
}
