/**
 * Aggregate tests — pure functions over synthetic Hevy documents.
 *
 * The fixtures below mirror the field names the live API actually returns
 * (`start_time`, `weight_kg`, `exercise_template_id`, `primary_muscle_group`),
 * captured from https://api.hevyapp.com/v1 on 2026-10-20, so a rename on the
 * Hevy side fails here before it fails in the panel.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DROPOFF_ALERT_PCT,
  MUSCLE_ORDER,
  buildOverview,
  consistency,
  dayKeyOf,
  dayKeyOfNumber,
  dayNumberOf,
  epley1Rm,
  indexTemplates,
  liftProgress,
  muscleBalance,
  recentSessions,
  sessionNotes,
  sessionQuality,
  setVolume,
  weekStartOf,
  weeklySeries,
  weightFreshness,
  weightTrend,
} from '../lib/aggregate.js'

/** Templates: two lifts, one with a secondary muscle group. */
const TEMPLATES = [
  {
    id: 'AAA111',
    title: 'Bench Press',
    type: 'weight_reps',
    primary_muscle_group: 'chest',
    secondary_muscle_groups: ['triceps', 'shoulders'],
    equipment: 'barbell',
    is_custom: false,
  },
  {
    id: 'BBB222',
    title: 'Barbell Row',
    type: 'weight_reps',
    primary_muscle_group: 'upper_back',
    secondary_muscle_groups: ['biceps'],
    equipment: 'barbell',
    is_custom: false,
  },
]

/** One workout on a given day with flat sets. */
function workout(id, startTime, exercises, description = '') {
  return {
    id,
    title: `Session ${id}`,
    routine_id: null,
    description,
    start_time: startTime,
    end_time: new Date(new Date(startTime).getTime() + 45 * 60_000).toISOString(),
    updated_at: startTime,
    created_at: startTime,
    exercises,
  }
}

/** One exercise block. */
function exercise(title, templateId, sets, notes = null) {
  return {
    index: 0,
    title,
    notes,
    exercise_template_id: templateId,
    superset_id: null,
    sets: sets.map((set, index) => ({
      index,
      type: set.type ?? 'normal',
      weight_kg: set.weight ?? null,
      reps: set.reps ?? null,
      distance_meters: null,
      duration_seconds: set.duration ?? null,
      rpe: set.rpe ?? null,
      custom_metric: null,
    })),
  }
}

/** Three sessions across two weeks, ending on the reference day. */
const NOW = new Date('2026-10-20T10:00:00+08:00')
const WORKOUTS = [
  workout('w1', '2026-10-19T18:00:00+08:00', [
    exercise('Bench Press', 'AAA111', [
      { weight: 60, reps: 8, type: 'warmup' },
      { weight: 80, reps: 5 },
      { weight: 80, reps: 5 },
    ]),
  ]),
  workout('w2', '2026-10-15T18:00:00+08:00', [
    exercise('Barbell Row', 'BBB222', [{ weight: 60, reps: 10 }]),
  ]),
  workout('w3', '2026-10-06T18:00:00+08:00', [
    exercise('Bench Press', 'AAA111', [{ weight: 75, reps: 5 }]),
  ]),
]

test('epley1Rm matches the Epley estimate and rejects unusable input', () => {
  assert.equal(epley1Rm(100, 1), 103.33333333333334)
  assert.equal(epley1Rm(80, 5), 80 * (1 + 5 / 30))
  assert.equal(epley1Rm(null, 5), 0)
  assert.equal(epley1Rm(80, 0), 0)
  assert.equal(epley1Rm(0, 5), 0)
})

test('setVolume is weight times reps and zero for bodyweight sets', () => {
  assert.equal(setVolume({ weight_kg: 80, reps: 5 }), 400)
  assert.equal(setVolume({ weight_kg: null, reps: 20 }), 0)
  assert.equal(setVolume({ weight_kg: 80, reps: null }), 0)
})

test('dayKeyOf buckets an instant in the requested zone', () => {
  // 18:00 in Asia/Makassar is 10:00 UTC the same day.
  assert.equal(dayKeyOf('2026-10-19T18:00:00+08:00', 'Asia/Makassar'), '2026-10-19')
  // The same instant is still 2026-10-19 in UTC.
  assert.equal(dayKeyOf('2026-10-19T18:00:00+08:00', 'UTC'), '2026-10-19')
  // Just past local midnight in Makassar, the UTC day is still the previous one.
  assert.equal(dayKeyOf('2026-10-20T00:30:00+08:00', 'Asia/Makassar'), '2026-10-20')
  assert.equal(dayKeyOf('2026-10-20T00:30:00+08:00', 'UTC'), '2026-10-19')
  assert.equal(dayKeyOf('not a date', 'UTC'), null)
})

test('day numbers round-trip and weeks start on Monday', () => {
  const dayNumber = dayNumberOf('2026-10-20')
  assert.equal(dayKeyOfNumber(dayNumber), '2026-10-20')
  // 2026-10-20 is a Tuesday, so its Monday is 2026-10-19.
  assert.equal(dayKeyOfNumber(weekStartOf(dayNumber)), '2026-10-19')
  // Sunday belongs to the week that started six days earlier.
  assert.equal(dayKeyOfNumber(weekStartOf(dayNumberOf('2026-10-25'))), '2026-10-19')
})

test('indexTemplates keeps the primary and secondary muscle groups', () => {
  const index = indexTemplates(TEMPLATES)
  assert.equal(index.size, 2)
  assert.equal(index.get('AAA111').primary, 'chest')
  assert.deepEqual(index.get('AAA111').secondary, ['triceps', 'shoulders'])
  assert.equal(index.get('BBB222').title, 'Barbell Row')
})

test('weeklySeries buckets sessions and skips warmup sets', () => {
  const weeks = weeklySeries(WORKOUTS, 4, 'Asia/Makassar', NOW)
  assert.equal(weeks.length, 4)
  const current = weeks.at(-1)
  assert.equal(current.weekStart, '2026-10-19')
  // w1 (Mon 19th) and w2 (Thu 15th) fall in different weeks.
  assert.equal(current.sessions, 1)
  assert.equal(current.sets, 2, 'the warmup set is not counted')
  assert.equal(current.volumeKg, 800, '2 × 80kg × 5')
  assert.equal(current.minutes, 45)

  const previous = weeks.at(-2)
  assert.equal(previous.weekStart, '2026-10-12')
  assert.equal(previous.sessions, 1)
  assert.equal(previous.volumeKg, 600)

  // w3 (2026-10-06) lands in the third bucket, so the oldest stays empty.
  assert.deepEqual(
    weeks.map((week) => week.sessions),
    [0, 1, 1, 1],
    'oldest weeks are listed first and stay empty when untrained',
  )
})

test('weeklySeries stops at the requested bucket count', () => {
  assert.equal(weeklySeries(WORKOUTS, 1, 'Asia/Makassar', NOW).length, 1)
  assert.equal(weeklySeries([], 6, 'Asia/Makassar', NOW).every((week) => week.sessions === 0), true)
})

test('muscleBalance credits primary sets at 1 and secondary at 0.5', () => {
  const templates = indexTemplates(TEMPLATES)
  const { rows } = muscleBalance(WORKOUTS, templates, 'Asia/Makassar', NOW, 28)
  const byGroup = Object.fromEntries(rows.map((row) => [row.group, row]))

  // Bench is trained twice in the window: 2 working sets on 10-19 plus 1 on
  // 10-06. The 10-19 warmup set is not credited. Secondary groups follow.
  assert.equal(byGroup.chest.sets, 3)
  assert.equal(byGroup.chest.volumeKg, 1175)
  assert.equal(byGroup.triceps.sets, 1.5)
  assert.equal(byGroup.shoulders.sets, 1.5)
  // Volume follows the same 0.5 credit as the set count, so a secondary row
  // never reads as "sets but no weight moved".
  assert.equal(byGroup.triceps.volumeKg, 587.5)
  assert.equal(byGroup.biceps.volumeKg, 300)
  // One row set: upper_back 1, biceps 0.5.
  assert.equal(byGroup.upper_back.sets, 1)
  assert.equal(byGroup.biceps.sets, 0.5)

  // Rows follow the canonical muscle order, chest before upper_back.
  const groups = rows.map((row) => row.group)
  assert.ok(groups.indexOf('chest') < groups.indexOf('upper_back'))
  assert.ok(groups.every((group) => MUSCLE_ORDER.includes(group)))
})

test('muscleBalance honours the window and reports the last training day', () => {
  const templates = indexTemplates(TEMPLATES)
  // A three-day window covers only the 10-19 session, so the row falls outside.
  const { rows, lastTrained } = muscleBalance(WORKOUTS, templates, 'Asia/Makassar', NOW, 3)
  assert.deepEqual(rows.map((row) => row.group), ['chest', 'shoulders', 'triceps'])
  assert.equal(rows.find((row) => row.group === 'chest').sets, 2)
  // `lastTrained` is computed over the whole history, not the window.
  assert.equal(lastTrained.chest, '2026-10-19')
})

test('liftProgress tracks the best estimated 1RM per lift', () => {
  const templates = indexTemplates(TEMPLATES)
  const { lifts, prs } = liftProgress(WORKOUTS, templates, 'Asia/Makassar', NOW)
  const bench = lifts.find((lift) => lift.templateId === 'AAA111')
  assert.equal(bench.title, 'Bench Press')
  assert.equal(bench.bestWeightKg, 80)
  assert.equal(bench.bestReps, 5)
  assert.equal(bench.bestAt, '2026-10-19')
  assert.equal(bench.sessions, 2)
  assert.deepEqual(
    bench.history.map((point) => point.date),
    ['2026-10-06', '2026-10-19'],
    'history is chronological',
  )
  // 80 × 5 beats the earlier 75 × 5, so this is a fresh PR.
  assert.deepEqual(prs.map((pr) => pr.templateId), ['AAA111'])
  assert.equal(prs[0].previousE1rm, Math.round(75 * (1 + 5 / 30) * 10) / 10)
  // The single-session row has no baseline and is not a PR.
  assert.equal(lifts.find((lift) => lift.templateId === 'BBB222').sessions, 1)
})

test('liftProgress ignores bodyweight-only lifts (no weight means no e1RM)', () => {
  const workouts = [
    workout('bw', '2026-10-19T18:00:00+08:00', [
      exercise('Push Up', 'CCC333', [{ reps: 25 }]),
    ]),
  ]
  const { lifts, prs } = liftProgress(workouts, new Map(), 'Asia/Makassar', NOW)
  assert.deepEqual(lifts, [])
  assert.deepEqual(prs, [])
})

test('recentSessions returns newest first with full set detail', () => {
  const sessions = recentSessions(WORKOUTS, 'Asia/Makassar', 2)
  assert.equal(sessions.length, 2)
  assert.equal(sessions[0].id, 'w1')
  assert.equal(sessions[1].id, 'w2')
  assert.equal(sessions[0].sets, 2)
  assert.equal(sessions[0].volumeKg, 800)
  assert.equal(sessions[0].minutes, 45)
  // Every set is kept for the detail view, including the warmup.
  const bench = sessions[0].exercises[0]
  assert.equal(bench.sets.length, 3)
  assert.equal(bench.sets[0].type, 'warmup')
  assert.equal(bench.sets[1].weightKg, 80)
})

test('weightTrend sorts measurements and computes the delta', () => {
  const trend = weightTrend([
    { id: 1, date: '2026-04-27', weight_kg: 65 },
    { id: 2, date: '2025-08-31', weight_kg: 68 },
    { id: 3, date: '2026-06-01', weight_kg: 66.5 },
  ])
  assert.deepEqual(trend.series.map((point) => point.date), ['2025-08-31', '2026-04-27', '2026-06-01'])
  assert.equal(trend.latest.weightKg, 66.5)
  assert.equal(trend.deltaKg, 1.5)

  const single = weightTrend([{ id: 1, date: '2026-04-27', weight_kg: 65 }])
  assert.equal(single.deltaKg, null)
  assert.deepEqual(weightTrend([]).series, [])
  assert.equal(weightTrend([]).latest, null)
})

test('buildOverview assembles every panel section from raw documents', () => {
  const overview = buildOverview({
    workouts: WORKOUTS,
    measurements: [{ id: 1, date: '2026-04-27', weight_kg: 65 }],
    templates: TEMPLATES,
    user: { username: 'ekajaya740', name: 'Test', weight_unit: 'kg', is_pro: true },
    weeks: 4,
    muscleWindowDays: 28,
    timeZone: 'Asia/Makassar',
    now: NOW,
  })

  assert.equal(overview.timeZone, 'Asia/Makassar')
  assert.equal(overview.user.isPro, true)
  assert.equal(overview.totals.workouts, 3)
  assert.equal(overview.totals.sessions, 3)
  assert.equal(overview.totals.volumeKg, 1775)
  assert.equal(overview.weeksSeries.length, 4)
  assert.equal(overview.consistency.window, 4)
  assert.equal(overview.lifts.length, 2)
  assert.equal(overview.prs.length, 1)
  assert.equal(overview.recent.length, 3)
  assert.equal(overview.weight.latest.weightKg, 65)
  // Chest was trained yesterday, so it is not stale; nothing else is either
  // except the untouched groups, which never appear in `muscles`.
  assert.deepEqual(overview.staleMuscles, [])
})

test('buildOverview tolerates partial credentials and empty history', () => {
  const overview = buildOverview({
    workouts: [],
    measurements: [],
    templates: [],
    user: null,
    weeks: 4,
    muscleWindowDays: 28,
    timeZone: 'UTC',
    now: NOW,
  })
  assert.equal(overview.user, null)
  assert.equal(overview.totals.workouts, 0)
  assert.deepEqual(overview.muscles, [])
  assert.deepEqual(overview.lifts, [])
  assert.deepEqual(overview.prs, [])
  assert.deepEqual(overview.recent, [])
  assert.equal(overview.weight.latest, null)
  assert.deepEqual(overview.staleMuscles, [])
})

test('buildOverview reports the newest session even when the window is empty', () => {
  const workouts = [
    workout('fresh', '2026-07-24T13:37:36+00:00', [exercise('Bench Press', 'AAA111', [{ weight: 80, reps: 5 }])]),
    workout('older', '2026-03-02T13:00:00+00:00', [exercise('Bench Press', 'AAA111', [{ weight: 75, reps: 5 }])]),
  ]
  const overview = buildOverview({
    workouts,
    measurements: [],
    templates: TEMPLATES,
    user: null,
    weeks: 12,
    muscleWindowDays: 28,
    timeZone: 'Asia/Makassar',
    now: NOW,
  })
  /* The 12-week window excludes both sessions, so the totals are honestly zero … */
  assert.equal(overview.totals.sessions, 0)
  /* … while lastSession still names the training the athlete actually did. */
  assert.deepEqual(overview.lastSession, { id: 'fresh', title: 'Session fresh', date: '2026-07-24' })
})

test('buildOverview returns lastSession null when there is no history at all', () => {
  const overview = buildOverview({
    workouts: [],
    measurements: [],
    templates: TEMPLATES,
    user: null,
    weeks: 12,
    muscleWindowDays: 28,
    timeZone: 'Asia/Makassar',
    now: NOW,
  })
  assert.equal(overview.lastSession, null)
})

test('buildOverview flags a muscle group left untouched past the stale threshold', () => {
  const old = [workout('old', '2026-08-01T18:00:00+08:00', [
    exercise('Bench Press', 'AAA111', [{ weight: 80, reps: 5 }]),
  ])]
  const overview = buildOverview({
    workouts: old,
    measurements: [],
    templates: TEMPLATES,
    user: null,
    weeks: 4,
    muscleWindowDays: 90,
    timeZone: 'Asia/Makassar',
    now: NOW,
  })
  /*
   * A bench session works the shoulders and triceps as secondaries, so all
   * three groups go stale together. Reporting only the chest implied the other
   * two had never been trained.
   */
  assert.deepEqual(overview.staleMuscles, [
    { group: 'chest', lastTrained: '2026-08-01' },
    { group: 'shoulders', lastTrained: '2026-08-01' },
    { group: 'triceps', lastTrained: '2026-08-01' },
  ])
})

test('weightTrend keeps one reading per date so a re-scan cannot fake a step change', () => {
  const trend = weightTrend([
    { id: 1, date: '2026-04-27', weight_kg: 65 },
    { id: 2, date: '2026-04-27', weight_kg: 66 },
    { id: 3, date: '2026-04-20', weight_kg: 64 },
  ])
  assert.equal(trend.series.length, 2)
  assert.equal(trend.latest.weightKg, 66)
  assert.equal(trend.deltaKg, 2)
})

test('weightFreshness reports how old the newest body-weight reading is', () => {
  const latest = { date: '2026-10-18', weightKg: 65 }
  const fresh = weightFreshness(latest, 'Asia/Makassar', NOW)
  assert.equal(fresh.daysSince, 2)
  assert.equal(fresh.stale, false)

  const stale = weightFreshness({ date: '2026-09-01', weightKg: 65 }, 'Asia/Makassar', NOW)
  assert.equal(stale.stale, true)

  /* No reading at all is "unknown", not "stale" — there is nothing to warn about. */
  assert.deepEqual(weightFreshness(null, 'Asia/Makassar', NOW), {
    daysSince: null,
    stale: false,
    staleAfterDays: 7,
  })
})

test('consistency does not reset the streak before the current week is trained', () => {
  /* Trained once in each of the three weeks before this one. */
  const steady = [
    workout('s1', '2026-10-14T18:00:00+08:00', [exercise('Bench Press', 'AAA111', [{ weight: 80, reps: 5 }])]),
    workout('s2', '2026-10-21T18:00:00+08:00', [exercise('Bench Press', 'AAA111', [{ weight: 80, reps: 5 }])]),
    workout('s3', '2026-10-28T18:00:00+08:00', [exercise('Bench Press', 'AAA111', [{ weight: 80, reps: 5 }])]),
  ]

  /* Monday 2026-11-02: the week in progress has no sessions yet, so the streak is 3 … */
  const monday = new Date('2026-11-02T07:00:00+08:00')
  const mondayFacts = consistency(weeklySeries(steady, 6, 'Asia/Makassar', monday), 4)
  assert.equal(mondayFacts.currentWeekSessions, 0)
  assert.equal(mondayFacts.streak, 3)

  /* … and stays 3 all week, rather than reading as zero until the first session. */
  const midweek = consistency(weeklySeries(steady, 6, 'Asia/Makassar', new Date('2026-11-06T07:00:00+08:00')), 4)
  assert.equal(midweek.streak, 3)

  /* Once this week is trained it counts, so the streak grows. */
  const trained = [...steady, workout('s4', '2026-11-04T18:00:00+08:00', [
    exercise('Bench Press', 'AAA111', [{ weight: 80, reps: 5 }]),
  ])]
  const thursday = consistency(weeklySeries(trained, 6, 'Asia/Makassar', new Date('2026-11-06T07:00:00+08:00')), 4)
  assert.equal(thursday.currentWeekSessions, 1)
  assert.equal(thursday.streak, 4)
})

test('consistency still breaks the streak on a genuinely skipped week', () => {
  const series = [
    { weekStart: '2026-10-05', sessions: 2 },
    { weekStart: '2026-10-12', sessions: 0 },
    { weekStart: '2026-10-19', sessions: 1 },
    { weekStart: '2026-10-26', sessions: 0 },
  ]
  const facts = consistency(series, 4)
  /* The empty week in the middle ends the streak even though the last week is empty. */
  assert.equal(facts.streak, 1)
  assert.equal(facts.activeWeeks, 2)
})

test('consistency handles an empty history without inventing a streak', () => {
  assert.deepEqual(consistency([], 4), {
    activeWeeks: 0,
    window: 0,
    streak: 0,
    averageSessions: 0,
    currentWeekSessions: 0,
  })
})

test('sessionQuality measures drop-off, failure sets and RPE coverage', () => {
  const sessions = [
    workout('q1', '2026-10-18T18:00:00+08:00', [
      exercise('Bench Press', 'AAA111', [
        { weight: 85, reps: 5, rpe: 8 },
        { weight: 85, reps: 5, rpe: 8 },
        /* A 40% load drop that ends the exercise — the journal's collapse case. */
        { weight: 50, reps: 8, type: 'failure' },
      ]),
      exercise('Barbell Row', 'BBB222', [
        { weight: 60, reps: 10, rpe: 7 },
        { weight: 60, reps: 10, type: 'dropset' },
      ]),
    ]),
    workout('q2', '2026-10-10T18:00:00+08:00', [
      exercise('Bench Press', 'AAA111', [{ weight: 80, reps: 5 }, { weight: 80, reps: 5 }]),
    ]),
  ]

  const quality = sessionQuality(sessions, 'Asia/Makassar', NOW)
  assert.equal(quality.workingSets, 7)
  assert.equal(quality.failureSets, 1)
  assert.equal(quality.dropsetSets, 1)
  assert.equal(quality.rpeSets, 3)
  assert.equal(quality.rpeCoverage, 0.43)
  assert.equal(quality.collapsedSessions, 1)

  const newest = quality.sessions[0]
  assert.equal(newest.dropoffExercise, 'Bench Press')
  assert.ok(newest.dropoffPct > DROPOFF_ALERT_PCT)
  assert.equal(newest.collapsed, true)

  /* The clean session has no drop-off, which is not the same as a drop of zero. */
  const clean = quality.sessions[1]
  assert.equal(clean.dropoffPct, 0)

  assert.equal(quality.lastFailureAt, '2026-10-18')
  assert.equal(quality.daysSinceFailure, 2)
})

test('sessionQuality reports null drop-off when nothing is comparable', () => {
  const quality = sessionQuality(
    [workout('solo', '2026-10-18T18:00:00+08:00', [
      exercise('Barbell Row', 'BBB222', [{ weight: 60, reps: 10 }]),
    ])],
    'Asia/Makassar',
    NOW,
  )
  assert.equal(quality.sessions[0].dropoffPct, null)
  assert.equal(quality.averageDropoffPct, null)
  assert.equal(quality.worstDropoffPct, null)
  assert.equal(quality.collapsedSessions, 0)
})

test('sessionQuality ignores sessions older than its window', () => {
  const old = [workout('ancient', '2026-06-01T18:00:00+08:00', [
    exercise('Bench Press', 'AAA111', [{ weight: 80, reps: 5 }]),
  ])]
  const quality = sessionQuality(old, 'Asia/Makassar', NOW, 42)
  assert.deepEqual(quality.sessions, [])
  assert.equal(quality.workingSets, 0)
  assert.equal(quality.lastFailureAt, null)
  assert.equal(quality.daysSinceFailure, null)
})

test('sessionNotes surfaces workout descriptions and exercise notes newest first', () => {
  const notes = sessionNotes([
    workout('n1', '2026-10-19T18:00:00+08:00', [
      exercise('Bench Press', 'AAA111', [{ weight: 80, reps: 5 }], 'Shoulder felt fine'),
    ], 'Machine chest press instead of barbell'),
    workout('n2', '2026-10-15T18:00:00+08:00', [
      exercise('Barbell Row', 'BBB222', [{ weight: 60, reps: 10 }]),
    ]),
    workout('n3', '2026-10-10T18:00:00+08:00', [
      exercise('Barbell Row', 'BBB222', [{ weight: 60, reps: 10 }], '  Left elbow sore  '),
    ], '  Sleep was bad  '),
  ])

  /* n2 carries no text at all, so it is dropped rather than rendered empty. */
  assert.deepEqual(notes.map((entry) => entry.id), ['n1', 'n3'])
  assert.equal(notes[0].note, 'Machine chest press instead of barbell')
  assert.deepEqual(notes[0].exerciseNotes, [{ title: 'Bench Press', notes: 'Shoulder felt fine' }])
  /* Whitespace-only text is not a note. */
  assert.equal(notes[1].note, 'Sleep was bad')
})

test('buildOverview exposes quality, notes and weight freshness', () => {
  const overview = buildOverview({
    workouts: [
      workout('t1', '2026-10-19T18:00:00+08:00', [
        exercise('Bench Press', 'AAA111', [
          { weight: 80, reps: 5, rpe: 8 },
          { weight: 80, reps: 5, rpe: 9 },
        ], 'Felt strong'),
      ], 'Solid session'),
    ],
    measurements: [{ id: 1, date: '2026-10-19', weight_kg: 65 }],
    templates: TEMPLATES,
    user: null,
    weeks: 4,
    muscleWindowDays: 28,
    timeZone: 'Asia/Makassar',
    now: NOW,
  })

  assert.equal(overview.quality.workingSets, 2)
  assert.equal(overview.quality.rpeCoverage, 1)
  assert.deepEqual(overview.notes.map((entry) => entry.id), ['t1'])
  assert.equal(overview.weightFreshness.daysSince, 1)
  assert.equal(overview.weightFreshness.stale, false)
})
