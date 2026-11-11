/**
 * dsh-hevy-training — Hevy public API client.
 *
 * Read-only by design: only `GET /v1/...` is ever issued. Hevy exposes no
 * delete or undo on any object, and `POST /v1/workouts` plus `POST /v1/routines`
 * are explicitly not idempotent, so a panel that cannot write cannot duplicate
 * a real training session by accident.
 *
 * Contract facts verified against https://api.hevyapp.com (2026-10-20):
 *   - base URL            https://api.hevyapp.com, all paths under /v1/
 *   - credential          header `api-key: <uuid>`, Hevy PRO required
 *   - pagination          `?page=&pageSize=`; envelope `{ page, page_count, <field> }`
 *   - pageSize ceiling    10 on /v1/workouts, 100 on /v1/exercise_templates
 *   - errors              plain-text body (`InvalidApiKey`) with 401, or a
 *                         JSON `{ "error": "..." }` for bad parameters
 *   - no rate-limit headers, no ETag, no idempotency key
 *
 * @module dsh-hevy-training/hevy
 */

/** Default API origin. */
export const DEFAULT_BASE_URL = 'https://api.hevyapp.com'

/** Workouts are served at most ten per page. */
const WORKOUT_PAGE_SIZE = 10

/** Exercise templates accept larger pages, which keeps the catalog at 5 calls. */
const TEMPLATE_PAGE_SIZE = 100

/** Hard ceilings so a broken `page_count` can never spin a request loop. */
const MAX_WORKOUT_PAGES = 40
const MAX_TEMPLATE_PAGES = 12

/**
 * One failed Hevy call.
 */
export class HevyError extends Error {
  /**
   * @param {string} message - human-readable reason.
   * @param {number|null} status - HTTP status when a response was read.
   * @param {string} body - first bytes of the error body, for diagnostics.
   */
  constructor(message, status = null, body = '') {
    super(message)
    this.name = 'HevyError'
    this.status = status
    this.body = body
  }
}

/**
 * Trim an error body to something loggable.
 * @param {string} text - raw response text.
 * @returns {string} at most 200 characters.
 */
function snippet(text) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 200)
}

/**
 * Read one Hevy response as JSON.
 * @param {Response} response - fetch response.
 * @returns {Promise<any>} parsed body.
 */
async function readJson(response) {
  const text = await response.text()
  if (!response.ok) {
    throw new HevyError(
      `Hevy responded ${response.status}: ${snippet(text) || response.statusText}`,
      response.status,
      snippet(text),
    )
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new HevyError(`Hevy returned non-JSON for ${response.url}`, response.status, snippet(text))
  }
}

/**
 * Build a read-only Hevy client bound to one API key.
 * @param {object} options - client options.
 * @param {string} options.apiKey - Hevy API key.
 * @param {string} [options.baseUrl] - API origin override.
 * @param {number} [options.timeoutMs] - per-request timeout.
 * @returns {{request: Function, fetchWorkouts: Function, fetchTemplates: Function, fetchMeasurements: Function, fetchUser: Function, fetchWorkoutCount: Function}} client.
 */
export function createHevyClient({ apiKey, baseUrl = DEFAULT_BASE_URL, timeoutMs = 20_000 }) {
  if (typeof apiKey !== 'string' || apiKey.trim() === '') {
    throw new HevyError('HEVY_API_KEY is not set', null, '')
  }
  const key = apiKey.trim()

  /**
   * Issue one authenticated GET.
   * @param {string} path - path below the origin, starting with a slash.
   * @param {Record<string, string|number>} [params] - query parameters.
   * @returns {Promise<any>} parsed JSON body.
   */
  async function request(path, params = {}) {
    const url = new URL(path, baseUrl)
    for (const [name, value] of Object.entries(params)) {
      url.searchParams.set(name, String(value))
    }
    let response
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { 'api-key': key, accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (cause) {
      throw new HevyError(`Hevy request failed: ${String(cause?.message ?? cause)}`, null, '')
    }
    return readJson(response)
  }

  /**
   * Walk a paginated collection.
   * @param {string} path - collection path.
   * @param {string} field - array field in the envelope.
   * @param {number} pageSize - page size accepted by that endpoint.
   * @param {number} maxPages - safety ceiling.
   * @returns {Promise<object[]>} every row, in API order.
   */
  async function listAll(path, field, pageSize, maxPages) {
    const first = await request(path, { page: 1, pageSize })
    const rows = Array.isArray(first?.[field]) ? [...first[field]] : []
    const pageCount = Number(first?.page_count ?? 1)
    const lastPage = Math.min(Number.isFinite(pageCount) ? pageCount : 1, maxPages)
    if (lastPage <= 1) return rows

    const rest = await Promise.all(
      Array.from({ length: lastPage - 1 }, (_unused, index) => request(path, { page: index + 2, pageSize })),
    )
    for (const page of rest) {
      if (Array.isArray(page?.[field])) rows.push(...page[field])
    }
    return rows
  }

  return {
    request,
    fetchWorkouts: () => listAll('/v1/workouts', 'workouts', WORKOUT_PAGE_SIZE, MAX_WORKOUT_PAGES),
    fetchTemplates: () => listAll('/v1/exercise_templates', 'exercise_templates', TEMPLATE_PAGE_SIZE, MAX_TEMPLATE_PAGES),
    fetchMeasurements: () => listAll('/v1/body_measurements', 'body_measurements', WORKOUT_PAGE_SIZE, MAX_WORKOUT_PAGES),
    fetchUser: async () => {
      const body = await request('/v1/user/info')
      return body?.data ?? null
    },
    fetchWorkoutCount: async () => {
      const body = await request('/v1/workouts/count')
      return Number(body?.workout_count ?? 0)
    },
  }
}
