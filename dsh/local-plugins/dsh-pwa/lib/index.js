/**
 * dsh-pwa — host half.
 *
 * Turns the DSH Web GUI into an installable, offline-aware Progressive Web App
 * without touching the shipped frontend build:
 *
 *   GET /manifest.webmanifest   → a richer web app manifest (overrides the
 *                                 minimal one in the frontend dist)
 *   GET /sw.js                  → the service worker, with its cache version
 *                                 derived from this plugin's own bytes
 *   GET /pwa/icons/<file>.png   → the PNG icon set (any / maskable / monochrome
 *                                 / apple-touch / favicon)
 *   GET /pwa/offline.html       → the offline fallback document
 *
 * `tapIndex` injects the iOS metas, the PNG icon links and the tiny client
 * script that registers the service worker and offers install/update chips.
 *
 * Every route here is public: icons, manifest and the worker source are static
 * bytes with no user data, exactly like the frontend dist assets the shipped
 * static server already serves without an auth check. The index HTML itself
 * stays behind `connection.authorizeIndex`, and the service worker never caches
 * anything under `/api`.
 *
 * @module dsh-pwa
 */
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Plugin name shown in the loader/plugin manager. */
export const name = 'dsh-pwa'

/** Host services this half needs. */
export const inject = ['webServer']

const HERE = dirname(fileURLToPath(import.meta.url))
const ICON_DIR = join(HERE, '..', 'assets', 'icons')
const GLYPH_SOURCE = join(HERE, '..', 'assets', 'brand-glyph.path')
const SW_SOURCE = join(HERE, 'sw.js')
const CLIENT_SOURCE = join(HERE, 'client.js')
const MOBILE_SOURCE = join(HERE, 'mobile.css')
const OFFLINE_SOURCE = join(HERE, 'offline.html')

/** Route prefix owning every PWA asset. */
const PWA_PREFIX = '/pwa'

/** Icon directory served under `/pwa/icons`. */
const ICON_ROUTE = `${PWA_PREFIX}/icons`

/** Manifest route — the same path the shipped index already links to. */
const MANIFEST_ROUTE = '/manifest.webmanifest'

/** Service worker route (scope root: the worker must sit at the origin root). */
const SW_ROUTE = '/sw.js'

/** Offline fallback document. */
const OFFLINE_ROUTE = `${PWA_PREFIX}/offline.html`

/** Media type per served extension. */
const MEDIA_TYPES = {
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
}

/**
 * The web app manifest. Kept as a literal so the served bytes (and the cache
 * version hashed from them) are obvious and diffable.
 *
 * `display: standalone` rather than the shipped `fullscreen`: a chat harness
 * wants the OS status bar (clock, battery, connectivity) visible.
 */
const MANIFEST = {
  id: '/',
  name: 'DeepSeek Harness',
  short_name: 'DSH',
  description: 'A DeepSeek Harness workspace in its own window.',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  display_override: ['standalone', 'minimal-ui'],
  orientation: 'any',
  background_color: '#0f1115',
  theme_color: '#0f1115',
  lang: 'en',
  dir: 'ltr',
  categories: ['productivity', 'developer'],
  prefer_related_applications: false,
  icons: [
    { src: `${ICON_ROUTE}/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: `${ICON_ROUTE}/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: `${ICON_ROUTE}/icon-maskable-192.png`, sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: `${ICON_ROUTE}/icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    { src: `${ICON_ROUTE}/icon-monochrome-512.png`, sizes: '512x512', type: 'image/png', purpose: 'monochrome' },
  ],
}

/**
 * Resolve plugin config.
 * @param {unknown} raw - user config from the profile patch.
 * @returns {{ enabled: boolean, installPrompt: boolean }} effective config.
 */
function resolveConfig(raw) {
  const config = raw !== null && typeof raw === 'object' ? raw : {}
  return {
    enabled: config.enabled !== false,
    installPrompt: config.installPrompt !== false,
  }
}

/** Memoized asset loads, keyed by absolute path. */
const fileCache = new Map()

/**
 * Read a plugin file once and memoize the bytes.
 * @param {string} path - absolute path.
 * @returns {Promise<string>} UTF-8 contents.
 */
function readText(path) {
  let pending = fileCache.get(path)
  if (pending === undefined) {
    pending = readFile(path, 'utf8')
    fileCache.set(path, pending)
  }
  return pending
}

/**
 * Read a binary plugin file once and memoize the bytes.
 * @param {string} path - absolute path.
 * @returns {Promise<Buffer>} file contents.
 */
function readBinary(path) {
  let pending = fileCache.get(path)
  if (pending === undefined) {
    pending = readFile(path)
    fileCache.set(path, pending)
  }
  return pending
}

/** Served icon inventory (file name → media type), resolved on first use. */
let iconInventory
function listIcons() {
  iconInventory ??= readdir(ICON_DIR).then((entries) => {
    const map = new Map()
    for (const entry of entries.sort()) {
      const type = MEDIA_TYPES[extname(entry).toLowerCase()]
      if (type !== undefined) map.set(entry, type)
    }
    return map
  })
  return iconInventory
}

/**
 * Derive the service worker cache version from everything this plugin serves.
 * Stable across restarts and across unchanged content, so a reload never loops
 * on a "new version" chip; changes exactly when an asset here changes.
 * @returns {Promise<string>} 12 hex characters.
 */
let version
function serviceWorkerVersion() {
  version ??= (async () => {
    const hash = createHash('sha256')
    hash.update(JSON.stringify(MANIFEST))
    hash.update(await readText(SW_SOURCE))
    hash.update(await readText(CLIENT_SOURCE))
    // Optional: the stylesheet is inlined only when present, so a missing file
    // must not fail the whole version hash (and with it /sw.js).
    hash.update(await readText(MOBILE_SOURCE).catch(() => ''))
    hash.update(await readText(OFFLINE_SOURCE))
    hash.update(await readText(GLYPH_SOURCE))
    for (const [entry, type] of await listIcons()) {
      hash.update(`${entry}:${type}`)
      hash.update(await readBinary(join(ICON_DIR, entry)))
    }
    return hash.digest('hex').slice(0, 12)
  })()
  return version
}

/**
 * Answer one static PWA asset.
 * @param {import('node:http').ServerResponse} res - response.
 * @param {number} status - HTTP status code.
 * @param {Buffer|string} body - payload.
 * @param {Record<string, string>} headers - extra headers.
 */
function send(res, status, body, headers) {
  const payload = typeof body === 'string' ? Buffer.from(body, 'utf8') : body
  res.writeHead(status, {
    'content-length': String(payload.byteLength),
    'x-content-type-options': 'nosniff',
    ...headers,
  })
  res.end(payload)
}

/**
 * Reject anything but GET/HEAD.
 * @param {import('node:http').IncomingMessage} req - request.
 * @param {import('node:http').ServerResponse} res - response.
 * @returns {boolean} whether the handler should continue.
 */
function allowRead(req, res) {
  const method = req.method ?? 'GET'
  if (method === 'GET' || method === 'HEAD') return true
  send(res, 405, 'method not allowed', {
    'content-type': 'text/plain; charset=utf-8',
    allow: 'GET, HEAD',
  })
  return false
}

/**
 * Answer HEAD with the same headers a GET would carry.
 * @param {import('node:http').IncomingMessage} req - request.
 * @param {import('node:http').ServerResponse} res - response.
 * @param {number} status - status code.
 * @param {Buffer|string} body - GET payload (only its length is used).
 * @param {Record<string, string>} headers - headers.
 * @returns {boolean} whether the request was a HEAD answered here.
 */
function headOnly(req, res, status, body, headers) {
  if ((req.method ?? 'GET') !== 'HEAD') return false
  const payload = typeof body === 'string' ? Buffer.from(body, 'utf8') : body
  // Mirror `send` exactly: a HEAD must advertise what the GET would carry.
  res.writeHead(status, {
    'content-length': String(payload.byteLength),
    'x-content-type-options': 'nosniff',
    ...headers,
  })
  res.end()
  return true
}

/**
 * Mount the routes and the index tap.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {unknown} rawConfig - plugin config.
 * @returns {void}
 */
export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig)
  if (!config.enabled) {
    ctx.logger?.info?.('dsh-pwa: disabled by config')
    return
  }

  const manifestBody = `${JSON.stringify(MANIFEST, null, 2)}\n`

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: MANIFEST_ROUTE,
    handler: async (req, res) => {
      if (!allowRead(req, res)) return
      const headers = {
        'content-type': 'application/manifest+json; charset=utf-8',
        // Must revalidate: a stale manifest would keep an old icon set alive.
        'cache-control': 'no-cache',
      }
      if (headOnly(req, res, 200, manifestBody, headers)) return
      send(res, 200, manifestBody, headers)
    },
  }), 'dsh-pwa: manifest route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: SW_ROUTE,
    handler: async (req, res) => {
      if (!allowRead(req, res)) return
      const source = (await readText(SW_SOURCE)).replaceAll('__DSH_PWA_VERSION__', await serviceWorkerVersion())
      const headers = {
        'content-type': 'text/javascript; charset=utf-8',
        // The worker must be allowed to control the whole origin, not just /.
        'service-worker-allowed': '/',
        // The browser only sees a new worker if this byte-compares differently.
        'cache-control': 'no-cache',
      }
      if (headOnly(req, res, 200, source, headers)) return
      send(res, 200, source, headers)
    },
  }), 'dsh-pwa: service worker route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: PWA_PREFIX,
    handler: async (req, res) => {
      if (!allowRead(req, res)) return
      const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://dsh.internal').pathname)

      if (pathname === OFFLINE_ROUTE) {
        // The glyph is inlined so the offline page renders with zero requests:
        // it is by definition served when the network is gone.
        const template = await readText(OFFLINE_SOURCE)
        const body = template.replace('__DSH_PWA_GLYPH__', (await readText(GLYPH_SOURCE)).trim())
        const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' }
        if (headOnly(req, res, 200, body, headers)) return
        send(res, 200, body, headers)
        return
      }

      if (pathname.startsWith(`${ICON_ROUTE}/`)) {
        const entry = pathname.slice(ICON_ROUTE.length + 1)
        const icons = await listIcons()
        const type = icons.get(entry)
        // The inventory doubles as a traversal guard: only known names match.
        if (type === undefined) {
          send(res, 404, 'not found', { 'content-type': 'text/plain; charset=utf-8' })
          return
        }
        const bytes = await readBinary(join(ICON_DIR, entry))
        const headers = { 'content-type': type, 'cache-control': 'public, max-age=86400' }
        if (headOnly(req, res, 200, bytes, headers)) return
        send(res, 200, bytes, headers)
        return
      }

      send(res, 404, 'not found', { 'content-type': 'text/plain; charset=utf-8' })
    },
  }), 'dsh-pwa: /pwa asset routes')

  ctx.effect(() => ctx.webServer.tapIndex((html) => injectIndex(html, config)), 'dsh-pwa: index tap')
}

/**
 * Rewrite the head of one index document: absolute manifest link, iOS metas,
 * PNG icon links and the client script.
 *
 * Absolute URLs matter because the served document carries `<base href="./">`,
 * so `./manifest.webmanifest` only resolves at the origin root.
 * @param {string} html - rendered index document.
 * @param {{ installPrompt: boolean }} config - effective config.
 * @returns {string} transformed document.
 */
function injectIndex(html, config) {
  const head = [
    `<!-- dsh-pwa -->`,
    `<link rel="manifest" href="${MANIFEST_ROUTE}" />`,
    `<meta name="mobile-web-app-capable" content="yes" />`,
    `<meta name="apple-mobile-web-app-capable" content="yes" />`,
    `<meta name="apple-mobile-web-app-status-bar-style" content="default" />`,
    `<meta name="apple-mobile-web-app-title" content="DSH" />`,
    `<link rel="apple-touch-icon" sizes="180x180" href="${ICON_ROUTE}/apple-touch-icon-180.png" />`,
    `<link rel="icon" type="image/png" sizes="32x32" href="${ICON_ROUTE}/favicon-32.png" />`,
    `<style>${MOBILE_CSS}</style>`,
    `<script>window.__dshPwaConfig=${JSON.stringify({ installPrompt: config.installPrompt })};${CLIENT_SCRIPT.replace(/<\/script>/gi, '<\\/script>')}</script>`,
  ].join('')

  // The dist head already links `./manifest.webmanifest`; drop it so the
  // absolute link above is the only manifest declaration.
  const deduped = html.replace(/<link\b[^>]*\brel=["']manifest["'][^>]*>/gi, '')
  const replaced = deduped.replace(/<\/head>/i, `${head}</head>`)
  if (replaced === deduped) {
    // No head to inject into (unexpected): serve the document unchanged rather
    // than corrupting it.
    return html
  }
  return replaced
}

// The client script and mobile stylesheet are embedded verbatim into the index
// head, and `tapIndex` transforms are synchronous — so both are read
// synchronously at import time rather than racing the first request with a
// promise.
let CLIENT_SCRIPT = ''
let MOBILE_CSS = ''
try {
  CLIENT_SCRIPT = readFileSync(CLIENT_SOURCE, 'utf8').trim()
} catch (error) {
  // A missing client script disables the service worker but not the manifest,
  // icons and iOS metas, so the plugin degrades instead of failing to load.
  CLIENT_SCRIPT = ''
}
try {
  MOBILE_CSS = readFileSync(MOBILE_SOURCE, 'utf8').trim()
} catch (error) {
  // Likewise: no mobile CSS, but the rest of the PWA surface still works.
  MOBILE_CSS = ''
}
