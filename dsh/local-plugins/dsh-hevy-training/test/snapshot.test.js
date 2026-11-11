/**
 * Snapshot, diff, digest and history tests.
 *
 * The snapshot exists so a later turn can compare two weeks without guessing
 * at field names, so these tests pin the parts a diff depends on: the schema
 * version, the always-complete muscle roster, stable ordering, the flag
 * vocabulary, and the refusal to compare across schema versions.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  MUSCLE_ORDER,
  SNAPSHOT_SCHEMA_VERSION,
  buildSnapshot,
  diffSnapshots,
  digestMarkdown,
} from '../lib/aggregate.js'
import {
  HISTORY_LIMIT,
  listSnapshots,
  loadPreviousSnapshot,
  loadSnapshot,
  pruneSnapshots,
  saveSnapshot,
} from '../lib/history.js'

/** Bench-press template. */
const TEMPLATES = [
  {
    id: 'AAA111',
    title: 'Bench Press',
    type: 'weight_reps',
    primary_muscle_group: 'chest',
    secondary_muscle_groups: ['triceps'],
    equipment: 'barbell',
    is_custom: false,
  },
]

/** One workout with flat sets. */
function workout(id, startTime, sets, extra = {}) {
  return {
    id,
    title: `Session ${id}`,
    routine_id: null,
    description: extra.description ?? '',
    start_time: startTime,
    end_time: new Date(new Date(startTime).getTime() + 45 * 60_000).toISOString(),
    updated_at: startTime,
    exercises: [
      {
        index: 0,
        title: 'Bench Press',
        notes: extra.notes ?? null,
        exercise_template_id: 'AAA111',
        superset_id: null,
        sets: sets.map((set, index) => ({
          index,
          type: set.type ?? 'normal',
          weight_kg: set.weight ?? null,
          reps: set.reps ?? null,
          distance_meters: null,
          duration_seconds: null,
          rpe: set.rpe ?? null,
          custom_metric: null,
        })),
      },
    ],
  }
}

const NOW = new Date('2026-10-20T10:00:00+08:00')
const TIME_ZONE = 'Asia/Makassar'

/** Input accepted by buildSnapshot. */
function input(overrides = {}) {
  return {
    workouts: [],
    measurements: [],
    templates: TEMPLATES,
    user: { username: 'lifter', name: 'Lifter', weight_unit: 'kg', is_pro: false },
    weeks: 12,
    muscleWindowDays: 28,
    qualityWindowDays: 42,
    timeZone: TIME_ZONE,
    now: NOW,
    ...overrides,
  }
}

test('buildSnapshot stamps the schema version and the day it describes', () => {
  const snapshot = buildSnapshot(input())
  assert.equal(snapshot.schemaVersion, SNAPSHOT_SCHEMA_VERSION)
  assert.equal(snapshot.asOf, '2026-10-20')
  assert.equal(snapshot.timeZone, TIME_ZONE)
  assert.equal(snapshot.window.weeks, 12)
  assert.equal(snapshot.athlete.username, 'lifter')
})

test('buildSnapshot always carries every muscle group, including untouched ones', () => {
  const snapshot = buildSnapshot(input())
  assert.deepEqual(snapshot.muscles.map((row) => row.group), MUSCLE_ORDER)
  for (const row of snapshot.muscles) {
    assert.equal(row.sets, 0)
    assert.equal(row.lastTrained, null)
    assert.equal(row.daysSince, null)
  }
})

test('buildSnapshot splits this week from the week before', () => {
  const snapshot = buildSnapshot(input({
    workouts: [
      workout('w1', '2026-10-19T18:00:00+08:00', [{ weight: 80, reps: 5 }]),
      workout('w0', '2026-10-13T18:00:00+08:00', [{ weight: 70, reps: 5 }]),
    ],
  }))
  assert.equal(snapshot.week.weekStart, '2026-10-19')
  assert.equal(snapshot.week.sessions, 1)
  assert.equal(snapshot.week.volumeKg, 400)
  assert.equal(snapshot.previousWeek.weekStart, '2026-10-12')
  assert.equal(snapshot.previousWeek.volumeKg, 350)
})

test('buildSnapshot orders lifts by template id so a diff lines up', () => {
  const templates = [
    ...TEMPLATES,
    { id: 'ZZZ999', title: 'Squat', type: 'weight_reps', primary_muscle_group: 'quadriceps', secondary_muscle_groups: [], equipment: 'barbell', is_custom: false },
  ]
  const squatWorkout = workout('w1', '2026-10-19T18:00:00+08:00', [{ weight: 120, reps: 5 }])
  squatWorkout.exercises[0].exercise_template_id = 'ZZZ999'
  squatWorkout.exercises[0].title = 'Squat'
  const benchWorkout = workout('w2', '2026-10-18T18:00:00+08:00', [{ weight: 80, reps: 5 }])
  const snapshot = buildSnapshot(input({ workouts: [squatWorkout, benchWorkout], templates }))
  assert.deepEqual(snapshot.lifts.map((lift) => lift.templateId), ['AAA111', 'ZZZ999'])
})

test('buildSnapshot flags what a weekly review must not miss', () => {
  const empty = buildSnapshot(input())
  assert.ok(empty.flags.includes('weight:none'))
  /*
   * `progression:failure-free` needs training inside the window to mean
   * anything: a lifter who has logged nothing is not "progressing without
   * failure", and `week:empty` already says the useful thing.
   */
  assert.ok(!empty.flags.includes('progression:failure-free'))

  const failureFree = buildSnapshot(input({
    workouts: [workout('w1', '2026-10-19T18:00:00+08:00', [{ weight: 80, reps: 5 }])],
  }))
  assert.ok(failureFree.flags.includes('progression:failure-free'))

  const tookToFailure = buildSnapshot(input({
    workouts: [workout('w1', '2026-10-19T18:00:00+08:00', [{ weight: 80, reps: 5, rpe: 7, type: 'failure' }])],
  }))
  assert.ok(!tookToFailure.flags.includes('progression:failure-free'))

  const thin = buildSnapshot(input({
    workouts: [workout('w1', '2026-10-19T18:00:00+08:00', [{ weight: 80, reps: 5 }])],
    measurements: [{ date: '2026-10-01', weight_kg: 80 }],
  }))
  assert.ok(thin.flags.includes('quality:rpe-thin'))
  assert.ok(thin.flags.includes('weight:stale'))
  assert.ok(!thin.flags.includes('week:empty'))
  /*
   * `muscle-stale` means "trained, then dropped" — a group that was never in
   * the program at all carries no signal, and `lastTrained: null` already says
   * so on the muscle row itself.
   */
  assert.ok(!thin.flags.includes('muscle-stale:quadriceps'))

  const lapsedQuad = workout('w0', '2026-08-01T18:00:00+08:00', [{ weight: 100, reps: 5 }])
  lapsedQuad.exercises[0].exercise_template_id = 'QQQ111'
  lapsedQuad.exercises[0].title = 'Squat'
  const lapsed = buildSnapshot(input({
    workouts: [lapsedQuad],
    templates: [...TEMPLATES, {
      id: 'QQQ111',
      title: 'Squat',
      type: 'weight_reps',
      primary_muscle_group: 'quadriceps',
      secondary_muscle_groups: [],
      equipment: 'barbell',
      is_custom: false,
    }],
  }))
  assert.ok(lapsed.flags.includes('muscle-stale:quadriceps'), 'a lapsed group is flagged')

  const collapsed = buildSnapshot(input({
    workouts: [workout('w1', '2026-10-19T18:00:00+08:00', [
      { weight: 100, reps: 5 },
      { weight: 50, reps: 5 },
    ])],
  }))
  assert.ok(collapsed.flags.includes('quality:collapse'))
})

test('buildSnapshot does not call a first-time athlete a broken streak', () => {
  /*
   * Nothing logged in the window means there was no streak to break. A
   * permanent warning on a fresh account teaches the reader to ignore flags.
   */
  const empty = buildSnapshot(input())
  assert.ok(!empty.flags.includes('streak:broken'))
  assert.ok(empty.flags.includes('week:empty'))

  /* But a lapsed athlete — trained inside the window, then stopped — is one. */
  const lapsed = buildSnapshot(input({
    workouts: [workout('w1', '2026-09-07T18:00:00+08:00', [{ weight: 80, reps: 5 }])],
  }))
  assert.ok(lapsed.flags.includes('streak:broken'))
})

test('buildSnapshot flags are sorted and deduplicated', () => {
  const snapshot = buildSnapshot(input())
  const sorted = [...snapshot.flags].sort()
  assert.deepEqual(snapshot.flags, sorted)
  assert.equal(new Set(snapshot.flags).size, snapshot.flags.length)
})

test('diffSnapshots reports changed scalars, not the unchanged ones', () => {
  const before = buildSnapshot(input({
    workouts: [workout('w1', '2026-10-19T18:00:00+08:00', [{ weight: 80, reps: 5 }])],
  }))
  const after = buildSnapshot(input({
    workouts: [
      workout('w2', '2026-10-19T18:00:00+08:00', [{ weight: 80, reps: 5 }, { weight: 80, reps: 5 }]),
    ],
  }))
  const diff = diffSnapshots(before, after)
  assert.equal(diff.comparable, true)
  const volume = diff.changes.find((change) => change.metric === 'week.volumeKg')
  assert.ok(volume !== undefined)
  assert.equal(volume.before, 400)
  assert.equal(volume.after, 800)
  assert.equal(volume.delta, 400)
  assert.equal(volume.deltaPct, 100)
  const untouched = diff.changes.find((change) => change.metric === 'consistency.streak')
  assert.equal(untouched, undefined, 'an unchanged metric is counted, not listed')
  assert.ok(diff.unchanged > 0)
})

test('diffSnapshots lists muscle-set changes per group', () => {
  const before = buildSnapshot(input({
    workouts: [workout('w1', '2026-10-19T18:00:00+08:00', [{ weight: 80, reps: 5 }])],
  }))
  const after = buildSnapshot(input())
  const diff = diffSnapshots(before, after)
  const chest = diff.changes.find((change) => change.metric === 'muscles.chest.sets')
  assert.equal(chest.before, 1)
  assert.equal(chest.after, 0)
  assert.equal(chest.deltaPct, -100)
})

test('diffSnapshots tracks flags that appeared and cleared', () => {
  const measurements = [{ date: '2026-10-19', weight_kg: 80 }]
  const trainedNoFailure = buildSnapshot(input({
    measurements,
    workouts: [workout('w1', '2026-10-19T18:00:00+08:00', [{ weight: 80, reps: 5 }])],
  }))
  const trainedToFailure = buildSnapshot(input({
    measurements,
    workouts: [workout('w1', '2026-10-19T18:00:00+08:00', [{ weight: 80, reps: 5, rpe: 7, type: 'failure' }])],
  }))
  const diff = diffSnapshots(trainedNoFailure, trainedToFailure)
  assert.ok(diff.flagsCleared.includes('progression:failure-free'))
  assert.ok(diff.flagsCleared.includes('quality:rpe-thin'))
  assert.deepEqual(diff.flagsAdded, [])

  /* A week with no training clears `week:empty` once a session lands in it. */
  const idle = buildSnapshot(input({ measurements }))
  const trained = diffSnapshots(idle, trainedNoFailure)
  assert.ok(trained.flagsCleared.includes('week:empty'))
})

test('diffSnapshots surfaces PRs and notes new since the previous snapshot', () => {
  const before = buildSnapshot(input({
    workouts: [workout('w1', '2026-10-19T18:00:00+08:00', [{ weight: 80, reps: 5 }])],
  }))
  const after = buildSnapshot(input({
    workouts: [
      workout('w2', '2026-10-19T18:00:00+08:00', [{ weight: 85, reps: 5 }], { description: 'felt strong' }),
      workout('w1', '2026-10-12T18:00:00+08:00', [{ weight: 80, reps: 5 }]),
    ],
  }))
  const diff = diffSnapshots(before, after)
  assert.equal(diff.newPrs.length, 1)
  assert.equal(diff.newPrs[0].weightKg, 85)
  assert.equal(diff.newNotes.length, 1)
  assert.equal(diff.newNotes[0].note, 'felt strong')
})

test('diffSnapshots refuses to compare across schema versions', () => {
  const current = buildSnapshot(input())
  const stale = { ...current, schemaVersion: SNAPSHOT_SCHEMA_VERSION + 1 }
  const diff = diffSnapshots(stale, current)
  assert.equal(diff.comparable, false)
  assert.match(diff.reason, /schemaVersion/)
  assert.deepEqual(diff.changes, [])
})

test('diffSnapshots explains a missing baseline instead of inventing one', () => {
  const current = buildSnapshot(input())
  assert.equal(diffSnapshots(null, current).comparable, false)
  assert.equal(diffSnapshots(null, current).reason, 'no previous snapshot')
  assert.equal(diffSnapshots(current, null).reason, 'no current snapshot')
})

test('diffSnapshots measures the gap between two snapshots', () => {
  const before = buildSnapshot(input({ now: new Date('2026-10-13T10:00:00+08:00') }))
  const after = buildSnapshot(input())
  assert.equal(diffSnapshots(before, after).daysBetween, 7)
})

test('digestMarkdown renders the week, the flags and the diff', () => {
  const before = buildSnapshot(input({ now: new Date('2026-10-13T10:00:00+08:00') }))
  const after = buildSnapshot(input({
    workouts: [workout('w1', '2026-10-19T18:00:00+08:00', [{ weight: 80, reps: 5 }], { description: 'good day' })],
  }))
  const text = digestMarkdown(after, before)
  assert.match(text, /^# Training digest — week of 2026-10-19/)
  assert.match(text, /## This week/)
  assert.match(text, /\| sessions \| 1 \| 0 \| \+1 \|/)
  assert.match(text, /## Needs attention/)
  assert.match(text, /No body-weight measurement on record\./)
  assert.match(text, /## Notes/)
  assert.match(text, /good day/)
  assert.match(text, /## Against the previous snapshot/)
  assert.ok(text.endsWith('\n'))
})

test('digestMarkdown works without a baseline', () => {
  const text = digestMarkdown(buildSnapshot(input()))
  assert.doesNotMatch(text, /## Against the previous snapshot/)
  assert.match(text, /No session logged yet this week\./)
  assert.match(text, /Nothing logged in the window\./)
})

test('digestMarkdown explains an incomparable diff rather than hiding it', () => {
  const current = buildSnapshot(input())
  const text = digestMarkdown(current, { ...current, schemaVersion: 99 })
  assert.match(text, /Not comparable: schemaVersion 99 → 1\./)
})

test('history keeps one document per day and returns the previous one', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dht-history-'))
  try {
    assert.deepEqual(await listSnapshots(dir), [])
    assert.equal(await loadPreviousSnapshot(dir, '2026-10-20'), null)
    assert.equal(await saveSnapshot(dir, { asOf: '2026-10-13', marker: 'first' }), '2026-10-13')
    assert.equal(await saveSnapshot(dir, { asOf: '2026-10-20', marker: 'today' }), '2026-10-20')

    const previous = await loadPreviousSnapshot(dir, '2026-10-20')
    assert.equal(previous.dayKey, '2026-10-13')
    assert.equal(previous.document.marker, 'first')
    assert.equal((await loadSnapshot(dir, '2026-10-20')).marker, 'today')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('history replaces a document rewritten on the same day', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dht-history-'))
  try {
    await saveSnapshot(dir, { asOf: '2026-10-20', marker: 'first' })
    await saveSnapshot(dir, { asOf: '2026-10-20', marker: 'second' })
    assert.deepEqual(await listSnapshots(dir), ['2026-10-20'])
    assert.equal((await loadSnapshot(dir, '2026-10-20')).marker, 'second')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('history ignores foreign and corrupt files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dht-history-'))
  try {
    await saveSnapshot(dir, { asOf: '2026-10-20', marker: 'ok' })
    await writeFile(join(dir, 'notes.txt'), 'not a snapshot', 'utf8')
    await writeFile(join(dir, '2026-10-19.json'), '{ truncated', 'utf8')
    assert.deepEqual(await listSnapshots(dir), ['2026-10-19', '2026-10-20'])
    assert.equal(await loadSnapshot(dir, '2026-10-19'), null)
    /* The corrupt day is skipped, not fatal. */
    const previous = await loadPreviousSnapshot(dir, '2026-10-21')
    assert.equal(previous.dayKey, '2026-10-20')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('history rejects a document with no usable day key', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dht-history-'))
  try {
    assert.equal(await saveSnapshot(dir, { marker: 'no asOf' }), null)
    assert.equal(await saveSnapshot(dir, { asOf: '../escape' }), null)
    assert.deepEqual(await listSnapshots(dir), [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('pruneSnapshots keeps the newest documents and drops the rest', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dht-history-'))
  try {
    for (const day of ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']) {
      await saveSnapshot(dir, { asOf: day })
    }
    const removed = await pruneSnapshots(dir, 2)
    assert.deepEqual(removed, ['2026-10-01', '2026-10-02'])
    assert.deepEqual(await listSnapshots(dir), ['2026-10-03', '2026-10-04'])
    assert.deepEqual(await pruneSnapshots(dir, HISTORY_LIMIT), [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
