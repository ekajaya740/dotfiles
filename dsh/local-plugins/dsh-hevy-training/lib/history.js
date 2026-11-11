/**
 * dsh-hevy-training — snapshot history.
 *
 * Stores one `/snapshot` document per calendar day so a later week can be
 * diffed against an earlier one without any bookkeeping on the caller's side.
 * This is a local cache of documents the host just computed; it is not a
 * training record and it is safe to delete at any time — the next request
 * rebuilds it from the Hevy API.
 *
 * Deliberately outside Hevy: nothing here writes to the athlete's account, so
 * the plugin keeps its read-only guarantee while still being diffable across
 * restarts and across agent sessions.
 *
 * @module dsh-hevy-training/history
 */
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** One stored document per file, named by its `asOf` day key. */
const FILE_PATTERN = /^(\d{4}-\d{2}-\d{2})\.json$/

/** How many daily documents to keep before the oldest is pruned. */
export const HISTORY_LIMIT = 120

/**
 * Whether a filename is one of ours, and which day it holds.
 * @param {string} name - directory entry name.
 * @returns {string|null} the `YYYY-MM-DD` key, or null.
 */
function dayKeyFromName(name) {
  const match = FILE_PATTERN.exec(name)
  return match === null ? null : match[1]
}

/**
 * Day keys present in the history directory, oldest first.
 * @param {string} dir - history directory.
 * @returns {Promise<string[]>} sorted day keys; empty when the directory is absent.
 */
export async function listSnapshots(dir) {
  try {
    const names = await readdir(dir)
    return names
      .map(dayKeyFromName)
      .filter((key) => key !== null)
      .sort()
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

/**
 * Read one stored snapshot.
 * @param {string} dir - history directory.
 * @param {string} dayKey - `YYYY-MM-DD` key.
 * @returns {Promise<object|null>} the document, or null when absent or unreadable.
 */
export async function loadSnapshot(dir, dayKey) {
  if (typeof dayKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return null
  try {
    const text = await readFile(join(dir, `${dayKey}.json`), 'utf8')
    const parsed = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object' ? parsed : null
  } catch {
    /* A corrupt or missing document is simply not history. */
    return null
  }
}

/**
 * Read the newest stored snapshot strictly before one day.
 *
 * Strictly before, because the caller has usually just written today's own
 * document; comparing a snapshot against itself would always report "no
 * change" and hide a genuine week-over-week move.
 *
 * @param {string} dir - history directory.
 * @param {string} dayKey - `YYYY-MM-DD` key to stay before.
 * @returns {Promise<{dayKey: string, document: object}|null>} earlier document.
 */
export async function loadPreviousSnapshot(dir, dayKey) {
  const keys = await listSnapshots(dir)
  for (let index = keys.length - 1; index >= 0; index -= 1) {
    if (keys[index] >= dayKey) continue
    const document = await loadSnapshot(dir, keys[index])
    if (document !== null) return { dayKey: keys[index], document }
  }
  return null
}

/**
 * Persist one snapshot, replacing any document already stored for that day.
 *
 * Written to a temporary name and renamed into place: a crash mid-write must
 * not leave a half-serialised document that the next diff silently trusts.
 *
 * @param {string} dir - history directory.
 * @param {object} document - snapshot document with an `asOf` day key.
 * @returns {Promise<string|null>} the key written, or null when not storable.
 */
export async function saveSnapshot(dir, document) {
  const dayKey = document?.asOf
  if (typeof dayKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return null
  await mkdir(dir, { recursive: true })
  const target = join(dir, `${dayKey}.json`)
  const temporary = `${target}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
  await rename(temporary, target)
  return dayKey
}

/**
 * Delete the oldest documents beyond the retention limit.
 * @param {string} dir - history directory.
 * @param {number} limit - how many documents to keep.
 * @returns {Promise<string[]>} keys removed, oldest first.
 */
export async function pruneSnapshots(dir, limit = HISTORY_LIMIT) {
  const keys = await listSnapshots(dir)
  if (keys.length <= limit) return []
  const excess = keys.slice(0, keys.length - limit)
  const removed = []
  for (const key of excess) {
    try {
      await unlink(join(dir, `${key}.json`))
      removed.push(key)
    } catch {
      /* Already gone, or not ours to remove; either way retention still holds. */
    }
  }
  return removed
}
