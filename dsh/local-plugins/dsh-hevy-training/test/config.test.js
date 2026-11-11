/**
 * Host-half config tests.
 *
 * `resolveConfig` is the only logic in `lib/index.js` that runs before anything
 * touches the network, and it is also what `Config.validate` reports to the
 * loader — a value it rejects shows up to the user as a plugin that refuses to
 * activate, so the bounds are worth pinning down here.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { Config, resolveConfig } from '../lib/index.js'

test('resolveConfig fills every default when the row has no config', () => {
  assert.deepEqual(resolveConfig(undefined), {
    enabled: true,
    apiKey: null,
    baseUrl: 'https://api.hevyapp.com',
    timeZone: null,
    weeks: 12,
    muscleWindowDays: 28,
    qualityWindowDays: 42,
    historyDir: null,
    snapshotHistoryDays: 120,
    cacheSeconds: 300,
  })
})

test('resolveConfig treats an empty string as absent, not as a value', () => {
  const config = resolveConfig({ apiKey: '  ', timeZone: '', baseUrl: '' })
  assert.equal(config.apiKey, null)
  assert.equal(config.timeZone, null)
  assert.equal(config.baseUrl, 'https://api.hevyapp.com')
})

test('resolveConfig rejects an unknown IANA zone', () => {
  assert.throws(() => resolveConfig({ timeZone: 'Mars/Olympus' }), /not a known IANA time zone/)
})

test('resolveConfig accepts a real IANA zone', () => {
  assert.equal(resolveConfig({ timeZone: 'Asia/Makassar' }).timeZone, 'Asia/Makassar')
})

test('resolveConfig enforces the integer bounds it documents', () => {
  assert.throws(() => resolveConfig({ weeks: 0 }), /weeks must be an integer in 1\.\.52/)
  assert.throws(() => resolveConfig({ weeks: 53 }), /weeks must be an integer in 1\.\.52/)
  assert.throws(() => resolveConfig({ weeks: 12.5 }), /weeks must be an integer/)
  assert.throws(() => resolveConfig({ muscleWindowDays: 6 }), /muscleWindowDays must be an integer in 7\.\.365/)
  assert.throws(() => resolveConfig({ qualityWindowDays: 6 }), /qualityWindowDays must be an integer in 7\.\.365/)
  assert.throws(() => resolveConfig({ cacheSeconds: 3601 }), /cacheSeconds must be an integer in 0\.\.3600/)
  assert.throws(() => resolveConfig({ snapshotHistoryDays: 366 }), /snapshotHistoryDays must be an integer in 0\.\.365/)
})

test('resolveConfig rejects a non-http baseUrl', () => {
  assert.throws(() => resolveConfig({ baseUrl: 'ftp://example.com' }), /must be an http\(s\) origin/)
})

test('Config.validate reports issues instead of throwing', () => {
  const bad = Config['~standard'].validate({ weeks: 99 })
  assert.equal(bad.value, undefined)
  assert.match(bad.issues[0].message, /weeks must be an integer/)

  const good = Config['~standard'].validate({ weeks: 8 })
  assert.equal(good.issues, undefined)
  assert.equal(good.value.weeks, 8)
})
