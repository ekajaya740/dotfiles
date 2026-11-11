/**
 * dsh-pwa — service worker source (served at /sw.js).
 *
 * The VERSION literal below is replaced at serve time with a hash of every
 * asset this plugin ships, so the worker's bytes change only when they should.
 *
 * Caching rules, chosen around what a harness actually needs:
 *
 *   /assets/*      content-hashed by the frontend build → cache-only. The hash
 *                  *is* the version, so a cached copy can never be stale and
 *                  repeat loads stop re-downloading ~1.4 MB of JS + CSS. A new
 *                  frontend build produces new names, which miss and refill.
 *   /plugins/*     module bundles carrying a `?rev=` — stale-while-revalidate so
 *                  a plugin upgrade self-heals on the next load instead of
 *                  pinning an old build.
 *   /pwa/*, /manifest.webmanifest, /sw.js
 *                  stable, no user data → cache-first.
 *   navigations    network-only. The served index carries a per-boot payload
 *                  and an auth fence; a cached shell would boot into a
 *                  half-dead app. Offline → the offline document.
 *   everything else (including /api/*)
 *                  untouched: plain network. Nothing about a live harness
 *                  session belongs in a cache.
 */
const VERSION = '__DSH_PWA_VERSION__'
/** Cache for stable PWA assets (icons, manifest, offline page). */
const SHELL_CACHE = `dsh-pwa-shell-${VERSION}`
/** Cache for content-hashed frontend assets. */
const ASSET_CACHE = `dsh-pwa-assets-${VERSION}`
/** Cache for plugin module bundles. */
const PLUGIN_CACHE = `dsh-pwa-plugins-${VERSION}`

/** Documents precached on install — tiny, and needed exactly when offline. */
const PRECACHE = [
  '/pwa/offline.html',
  '/pwa/icons/icon-192.png',
  '/pwa/icons/icon-512.png',
  '/manifest.webmanifest',
]

/** Requests that must never be answered from a cache. */
const NEVER = [/^\/api\//, /^\/sw\.js$/]

/**
 * Upper bound on entries in the asset cache. A frontend upgrade produces new
 * hashed names while the old ones stay behind, so the cache needs a ceiling or
 * it grows by ~1.4 MB per rebuild. Far above one build's actual asset count
 * (fonts and language files included), so a normal session never evicts.
 */
const MAX_ASSET_ENTRIES = 96

/** Ceiling for plugin module bundles, which change name on every plugin bump. */
const MAX_PLUGIN_ENTRIES = 32

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE)
    // Individual failures must not fail the whole install (an offline install
    // attempt would otherwise retry forever).
    await Promise.all(PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {})))
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, ASSET_CACHE, PLUGIN_CACHE])
    for (const key of await caches.keys()) {
      if (key.startsWith('dsh-pwa-') && !keep.has(key)) await caches.delete(key)
    }
    await self.clients.claim()
  })())
})

self.addEventListener('message', (event) => {
  if (event.data === 'CLEAR_CACHES') {
    event.waitUntil((async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('dsh-pwa-')) await caches.delete(key)
      }
    })())
  }
})

/**
 * Put a response in a cache, but only when it is worth keeping.
 * @param {string} cacheName - destination cache.
 * @param {Request} request - cache key.
 * @param {Response} response - candidate response.
 * @returns {Promise<void>} resolves once stored (or skipped).
 */
async function stash(cacheName, request, response) {
  if (!response.ok || response.status === 206 || response.type === 'opaque') return
  const cache = await caches.open(cacheName)
  await cache.put(request, response.clone())
}

/**
 * Cache-first with a background revalidate: fast load, self-healing entry.
 * For stable URLs whose *content* may change (icons, the offline page).
 * @param {Request} request - incoming request.
 * @param {string} cacheName - cache to consult.
 * @returns {Promise<Response>} the response to return.
 */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(request, { ignoreSearch: false })
  const network = fetch(request).then(async (response) => {
    await stash(cacheName, request, response)
    return response
  })
  if (hit !== undefined) {
    // Revalidate in the background; failures are irrelevant to this response.
    network.catch(() => {})
    return hit
  }
  return network
}

/**
 * Cache-first with no revalidation: the URL is content-addressed, so a hit is
 * by definition current and a refetch would only cost bandwidth.
 * @param {Request} request - incoming request.
 * @param {string} cacheName - cache to consult.
 * @returns {Promise<Response>} the response to return.
 */
async function cacheImmutable(request, cacheName) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(request)
  if (hit !== undefined) return hit
  const response = await fetch(request)
  if (response.ok && response.status !== 206 && response.type !== 'opaque') {
    await cache.put(request, response.clone())
    await trim(cacheName, MAX_ASSET_ENTRIES)
  }
  return response
}

/**
 * Keep a cache under a size ceiling, dropping the oldest entries first.
 * `caches.keys()` has no timestamps; Cache.keys() returns insertion order, so
 * the front of the list is what has gone longest without being rewritten.
 * @param {string} cacheName - cache to trim.
 * @param {number} max - maximum entries retained.
 * @returns {Promise<void>} resolves once trimmed.
 */
async function trim(cacheName, max) {
  const cache = await caches.open(cacheName)
  const keys = await cache.keys()
  if (keys.length <= max) return
  await Promise.all(keys.slice(0, keys.length - max).map((request) => cache.delete(request)))
}

/**
 * Stale-while-revalidate: serve the cached copy now, refresh it for next time.
 * @param {Request} request - incoming request.
 * @param {string} cacheName - cache to consult.
 * @param {number} max - entry ceiling enforced after each refresh.
 * @returns {Promise<Response>} the response to return.
 */
async function staleWhileRevalidate(request, cacheName, max) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(request)
  const network = fetch(request).then(async (response) => {
    if (response.ok && response.status !== 206 && response.type !== 'opaque') {
      await cache.put(request, response.clone())
      await trim(cacheName, max)
    }
    return response
  })
  if (hit !== undefined) {
    network.catch(() => {})
    return hit
  }
  return network
}

/**
 * Answer a navigation: always the network, and an honest offline document when
 * the server cannot be reached.
 * @param {Request} request - navigation request.
 * @returns {Promise<Response>} the response to return.
 */
async function navigate(request) {
  try {
    return await fetch(request)
  } catch {
    const cache = await caches.open(SHELL_CACHE)
    const offline = await cache.match('/pwa/offline.html')
    if (offline !== undefined) return offline
    return new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (NEVER.some((pattern) => pattern.test(url.pathname))) return

  if (request.mode === 'navigate') {
    event.respondWith(navigate(request))
    return
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheImmutable(request, ASSET_CACHE))
    return
  }

  if (url.pathname.startsWith('/plugins/')) {
    event.respondWith(staleWhileRevalidate(request, PLUGIN_CACHE, MAX_PLUGIN_ENTRIES))
    return
  }

  if (
    url.pathname.startsWith('/pwa/')
    || url.pathname === '/manifest.webmanifest'
    || url.pathname === '/favicon.svg'
    || url.pathname === '/favicon-dark.svg'
  ) {
    event.respondWith(cacheFirst(request, SHELL_CACHE))
  }
})
