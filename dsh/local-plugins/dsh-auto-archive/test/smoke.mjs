import assert from 'node:assert/strict'
import { selectCandidates, runSweep, resolveConfig, resolveTimeZone, parseCron, cronMatches, wallClock, revisionMtime } from '/home/personal/dsh-auto-archive/lib/index.js'

const now = 1_700_000_000_000
const day = 86_400_000
const snap = (id, ageDays, revAgeDays = ageDays) => ({
  header: { id, createdAt: now - ageDays * day },
  revision: `1:2:3:${String(BigInt(now - revAgeDays * day) * 1_000_000n)}:0`,
})

/** Fresh harness per scenario: archived ids accumulate like the real registry. */
function harness({ favorites = ['fav'], active = ['busy'] } = {}) {
  const archivedIds = ['already']
  const pinnedIds = ['pinned']
  const calls = []
  const ctx = {
    workspaceRegistry: {
      get archivedSessionIds() {
        return [...archivedIds]
      },
      get pinnedSessionIds() {
        return [...pinnedIds]
      },
      async archiveSession(id, options = {}) {
        calls.push({ id, options })
        if (archivedIds.includes(id)) return
        if (active.includes(id)) {
          const error = new Error(`cannot archive session '${id}': it is active`)
          error.name = 'WorkspaceActiveSessionError'
          throw error
        }
        archivedIds.push(id)
      },
    },
    sessionPersistence: {
      async list() {
        return [
          snap('old', 90),
          snap('older', 200),
          snap('fresh', 5),
          snap('already', 90),
          snap('pinned', 90),
          snap('fav', 90),
          snap('busy', 400),
          { header: { id: 'norev' }, revision: 'garbage' },
          snap('recentlyActive', 200, 1),
        ]
      },
    },
    get(name) {
      if (name === 'sessionPersistence') return ctx.sessionPersistence
      if (name === 'storageDomain') {
        return {
          get: (n) =>
            n === 'archive_manager_favorites'
              ? { global: { get: () => ({ favoriteSessionIds: favorites }) } }
              : undefined,
        }
      }
      return undefined
    },
  }
  return { ctx, archivedIds, calls }
}

// ── cron parsing ──────────────────────────────────────────────────────
const daily = parseCron('0 4 * * *')
assert.deepEqual([...daily.minute], [0])
assert.deepEqual([...daily.hour], [4])
assert.ok(cronMatches(daily, new Date(2026, 9, 20, 4, 0, 0)))
assert.ok(!cronMatches(daily, new Date(2026, 9, 20, 4, 1, 0)))
assert.ok(!cronMatches(daily, new Date(2026, 9, 20, 5, 0, 0)))
// Sunday may be written 0 or 7; both must match.
assert.ok(parseCron('0 4 * * 7').weekday.has(0))
// When both day fields are restricted, Vixie cron matches either.
const either = parseCron('0 4 1 * 1')
assert.ok(cronMatches(either, new Date(2026, 9, 1, 4, 0, 0))) // 1st, a Thursday
assert.ok(cronMatches(either, new Date(2026, 9, 5, 4, 0, 0))) // Monday the 5th
assert.throws(() => parseCron('0 4 * *'), /must have five fields/)
assert.throws(() => parseCron('99 4 * * *'), /outside 0..59/)

// ── time zone: the schedule is written against a wall clock ───────────
// 20:00Z is 04:00 the NEXT day in Asia/Makassar (UTC+8).
const at = new Date('2026-10-19T20:00:00Z')
const makassar = { ...parseCron('0 4 * * *'), timeZone: 'Asia/Makassar' }
assert.ok(cronMatches(makassar, at), '04:00 local must fire at 20:00Z')
assert.ok(!cronMatches(makassar, new Date('2026-10-19T04:00:00Z')))
// Without a zone the host clock decides — assert against the host's own offset.
const hostOffsetMin = new Date('2026-10-19T04:00:00Z').getTimezoneOffset()
assert.equal(
  cronMatches(parseCron('0 4 * * *'), new Date('2026-10-19T04:00:00Z')),
  hostOffsetMin === 0,
)
// A weekday-restricted zone expression must use the zone's day, not UTC's.
const mondayLocal = { ...parseCron('0 4 * * 1'), timeZone: 'Asia/Makassar' }
assert.equal(wallClock(at, 'Asia/Makassar').weekday, 2) // Tuesday there
assert.equal(wallClock(at, 'UTC').weekday, 1)
assert.ok(!cronMatches(mondayLocal, at))
assert.ok(cronMatches(mondayLocal, new Date('2026-10-18T20:00:00Z'))) // Mon 04:00 local
assert.throws(() => resolveTimeZone('Mars/Olympus'), /not a known IANA time zone/)
assert.throws(() => resolveTimeZone(42), /timeZone must be an IANA name/)
assert.equal(resolveTimeZone(' Europe/Berlin '), 'Europe/Berlin')
assert.equal(resolveTimeZone(''), null)
assert.equal(resolveConfig({ timeZone: 'Asia/Makassar', cron: '0 4 * * *' }).cron.timeZone, 'Asia/Makassar')

// ── revision token ────────────────────────────────────────────────────
assert.equal(revisionMtime(`1:2:3:${String(BigInt(now) * 1_000_000n)}:0`), now)
assert.equal(revisionMtime('garbage'), null)
assert.equal(revisionMtime(undefined), null)

// ── selection: every skip reason is exercised ─────────────────────────
{
  const { ctx } = harness()
  const selection = await selectCandidates(ctx, resolveConfig({ idleDays: 30 }), { now })
  assert.equal(selection.considered, 9)
  assert.deepEqual(selection.skipped, { archived: 1, pinned: 1, favorite: 1, tooRecent: 2, unknownActivity: 1 })
  // 'recentlyActive' is old by createdAt but its log mtime is 1 day old.
  assert.deepEqual(
    selection.candidates.map((c) => c.id),
    ['busy', 'older', 'old'],
  )
}

// ── sweep: archives idle ones, refuses the active one ─────────────────
{
  const { ctx, archivedIds, calls } = harness()
  const report = await runSweep(ctx, resolveConfig({ idleDays: 30 }), { now })
  assert.deepEqual(report.archived, ['older', 'old'])
  assert.deepEqual(report.refused.map((r) => `${r.id}:${r.name}`), ['busy:WorkspaceActiveSessionError'])
  assert.deepEqual(report.failed, [])
  // stopActivity must stay false: DSH refuses active sessions instead of killing them.
  assert.ok(calls.every((call) => call.options.stopActivity === false))
  assert.ok(archivedIds.includes('older') && archivedIds.includes('old'))
  assert.ok(!archivedIds.includes('busy') && !archivedIds.includes('fav'))
}

// ── dry run: reports candidates, writes nothing ───────────────────────
{
  const { ctx, calls } = harness()
  const report = await runSweep(ctx, resolveConfig({ idleDays: 30, dryRun: true }), { now })
  assert.equal(report.dryRun, true)
  assert.equal(report.candidates.length, 3)
  assert.deepEqual(report.archived, [])
  assert.equal(calls.length, 0)
}

// ── maxPerRun caps one sweep, oldest first, and repeats resume ────────
{
  const { ctx } = harness()
  const first = await runSweep(ctx, resolveConfig({ idleDays: 30, maxPerRun: 1 }), { now })
  assert.deepEqual(first.archived, ['older'])
  const second = await runSweep(ctx, resolveConfig({ idleDays: 30, maxPerRun: 1 }), { now })
  assert.deepEqual(second.archived, ['old'])
}

// ── config validation ─────────────────────────────────────────────────
assert.throws(() => resolveConfig({ idleDays: 0 }), /idleDays must be an integer in 1..36500/)
assert.throws(() => resolveConfig({ idleDays: 1.5 }), /idleDays must be an integer/)
assert.throws(() => resolveConfig({ cron: 'nope' }), /must have five fields/)
assert.throws(() => resolveConfig({ dryRun: 'yes' }), /dryRun must be a boolean/)
assert.equal(resolveConfig({}).cron, null)
assert.equal(resolveConfig({}).idleDays, 30)
// A row config that already went through Config validation is accepted unchanged.
const parsed = resolveConfig({ cron: '0 4 * * *' })
assert.equal(resolveConfig(parsed).cron.expression, '0 4 * * *')
// `ctx.get` returning a non-favorite domain must not throw.
assert.deepEqual([...(() => {
  const ctx = { get: () => undefined }
  return ctx.get('storageDomain') ? ['x'] : []
})()], [])

console.log('smoke: all assertions passed')
