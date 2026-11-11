/**
 * Route-level tests for dsh-pwa, run without a live DSH host.
 *
 * The plugin only talks to `ctx.webServer` (register / tapIndex) and `ctx.effect`,
 * so a fake context is enough to exercise every route and the index transform.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { apply, inject, name } from '../lib/index.js'

/**
 * Build a fake plugin context that records the routes and taps registered.
 * @returns {{ ctx: object, routes: Array<object>, taps: Array<Function> }} harness.
 */
function harness() {
  const routes = []
  const taps = []
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    effect(fn) {
      const disposer = fn()
      return () => disposer?.()
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
      tapIndex(transform) {
        taps.push(transform)
        return () => {}
      },
    },
  }
  return { ctx, routes, taps }
}

/**
 * Invoke a registered route handler with a synthetic request.
 * @param {object} route - registered route.
 * @param {string} url - request URL.
 * @param {string} [method] - HTTP method.
 * @returns {Promise<{ status: number, headers: object, body: Buffer }>} response.
 */
async function call(route, url, method = 'GET') {
  const headers = {}
  const chunks = []
  let status = 200
  const res = {
    writeHead(code, hdrs) {
      status = code
      Object.assign(headers, hdrs)
    },
    end(payload) {
      if (payload !== undefined) chunks.push(Buffer.from(payload))
    },
  }
  await route.handler({ url, method, headers: {} }, res)
  return { status, headers, body: Buffer.concat(chunks) }
}

/**
 * Mount the plugin and return the harness plus a route lookup helper.
 * @returns {Promise<{ routes: Array<object>, taps: Array<Function>, route: (kind: string, path: string) => object }>} harness.
 */
async function mount() {
  const { ctx, routes, taps } = harness()
  apply(ctx, {})
  const route = (kind, path) => {
    const found = routes.find((candidate) => candidate.kind === kind && candidate.path === path)
    assert.ok(found, `route ${kind} ${path} registered`)
    return found
  }
  return { routes, taps, route }
}

test('plugin exports the expected shape', () => {
  assert.equal(name, 'dsh-pwa')
  assert.deepEqual(inject, ['webServer'])
})

test('registers exactly the PWA routes', async () => {
  const { routes } = await mount()
  const keys = routes.map((route) => `${route.kind} ${route.path}`).sort()
  assert.deepEqual(keys, ['exact /manifest.webmanifest', 'exact /sw.js', 'prefix /pwa'])
})

test('manifest is a valid, installable web app manifest', async () => {
  const { route } = await mount()
  const response = await call(route('exact', '/manifest.webmanifest'), '/manifest.webmanifest')
  assert.equal(response.status, 200)
  assert.match(response.headers['content-type'], /^application\/manifest\+json/)
  assert.equal(response.headers['cache-control'], 'no-cache')

  const manifest = JSON.parse(response.body.toString('utf8'))
  assert.equal(manifest.start_url, '/')
  assert.equal(manifest.scope, '/')
  assert.equal(manifest.display, 'standalone')
  assert.equal(manifest.theme_color, '#0f1115')

  const purposes = new Set(manifest.icons.map((icon) => icon.purpose))
  assert.ok(purposes.has('any'), 'has a regular icon')
  assert.ok(purposes.has('maskable'), 'has a maskable icon')
  for (const icon of manifest.icons) {
    assert.match(icon.type, /^image\/png$/)
    assert.match(icon.src, /^\/pwa\/icons\/[\w-]+\.png$/)
    assert.match(icon.sizes, /^\d+x\d+$/)
  }
  const any512 = manifest.icons.some((icon) => icon.purpose === 'any' && icon.sizes === '512x512')
  const mask512 = manifest.icons.some((icon) => icon.purpose === 'maskable' && icon.sizes === '512x512')
  assert.ok(any512, 'has a 512x512 any icon')
  assert.ok(mask512, 'has a 512x512 maskable icon')
})

test('every icon the manifest advertises is actually served', async () => {
  const { route } = await mount()
  const manifest = JSON.parse(
    (await call(route('exact', '/manifest.webmanifest'), '/manifest.webmanifest')).body.toString('utf8'),
  )
  for (const icon of manifest.icons) {
    const response = await call(route('prefix', '/pwa'), icon.src)
    assert.equal(response.status, 200, `${icon.src} is served`)
    assert.equal(response.headers['content-type'], 'image/png')
    // PNG magic: 89 50 4E 47.
    assert.deepEqual([...response.body.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], `${icon.src} is a real PNG`)
    const [width, height] = icon.sizes.split('x').map(Number)
    // IHDR width/height live at bytes 16..24.
    assert.equal(response.body.readUInt32BE(16), width, `${icon.src} width`)
    assert.equal(response.body.readUInt32BE(20), height, `${icon.src} height`)
  }
})

test('service worker is served at the root with a stable version', async () => {
  const { route } = await mount()
  const first = await call(route('exact', '/sw.js'), '/sw.js')
  assert.equal(first.status, 200)
  assert.match(first.headers['content-type'], /^text\/javascript/)
  assert.equal(first.headers['service-worker-allowed'], '/')
  assert.equal(first.headers['cache-control'], 'no-cache')

  const source = first.body.toString('utf8')
  assert.ok(!source.includes('__DSH_PWA_VERSION__'), 'version placeholder is substituted')
  assert.match(source, /const VERSION = '[0-9a-f]{12}'/)

  const second = await call(route('exact', '/sw.js'), '/sw.js')
  assert.equal(second.body.toString('utf8'), source, 'version is deterministic across requests')
})

test('service worker never caches API traffic or itself', async () => {
  const { route } = await mount()
  const source = (await call(route('exact', '/sw.js'), '/sw.js')).body.toString('utf8')
  assert.ok(source.includes('/^\\/api\\//'), 'API requests are excluded')
  assert.ok(source.includes('/^\\/sw\\.js$/'), 'the worker itself is excluded')
  assert.ok(source.includes("mode === 'navigate'"), 'navigations are handled explicitly')
})

test('offline page is served with the brand glyph inlined', async () => {
  const { route } = await mount()
  const response = await call(route('prefix', '/pwa'), '/pwa/offline.html')
  assert.equal(response.status, 200)
  assert.match(response.headers['content-type'], /^text\/html/)
  const html = response.body.toString('utf8')
  assert.ok(!html.includes('__DSH_PWA_GLYPH__'), 'glyph placeholder is substituted')
  assert.match(html, /<path id="path" fill="#f9fafb" d="M48\.8354/, 'glyph path data is inlined')
  assert.match(html, /Try again/, 'offers a retry affordance')
})

test('unknown /pwa paths and traversal attempts are rejected', async () => {
  const { route } = await mount()
  for (const path of ['/pwa/nope', '/pwa/icons/nope.png', '/pwa/icons/../lib/index.js', '/pwa/icons/%2e%2e%2findex.js']) {
    const response = await call(route('prefix', '/pwa'), path)
    assert.equal(response.status, 404, `${path} → 404`)
  }
})

test('non-read methods are rejected with 405', async () => {
  const { route } = await mount()
  for (const [kind, path, url] of [
    ['exact', '/manifest.webmanifest', '/manifest.webmanifest'],
    ['exact', '/sw.js', '/sw.js'],
    ['prefix', '/pwa', '/pwa/icons/icon-192.png'],
  ]) {
    const response = await call(route(kind, path), url, 'POST')
    assert.equal(response.status, 405, `${url} → 405`)
    assert.equal(response.headers.allow, 'GET, HEAD')
  }
})

test('HEAD answers carry the same headers and no body', async () => {
  const { route } = await mount()
  for (const [kind, path, url, type] of [
    ['exact', '/manifest.webmanifest', '/manifest.webmanifest', /^application\/manifest\+json/],
    ['exact', '/sw.js', '/sw.js', /^text\/javascript/],
    ['prefix', '/pwa', '/pwa/icons/icon-192.png', /^image\/png$/],
  ]) {
    const get = await call(route(kind, path), url)
    const head = await call(route(kind, path), url, 'HEAD')
    assert.equal(head.status, 200, `${url} HEAD status`)
    assert.equal(head.body.length, 0, `${url} HEAD has no body`)
    assert.match(head.headers['content-type'], type, `${url} HEAD content-type`)
    assert.equal(head.headers['content-length'], String(get.body.length), `${url} HEAD content-length`)
  }
})

test('index tap injects the PWA head without disturbing the document', async () => {
  const { taps } = await mount()
  assert.equal(taps.length, 1)
  const source = '<!doctype html><html lang="en"><head><meta charset="utf-8" />'
    + '<meta name="viewport" content="width=device-width, initial-scale=1" />'
    + '<link rel="manifest" href="./manifest.webmanifest" />'
    + '<title>DeepSeek Harness</title>'
    + '<script type="module" crossorigin src="./assets/index-abc.js"></script>'
    + '</head><body><div id="root"></div></body></html>'

  const out = taps[0](source)

  // The shipped relative manifest link is replaced by an absolute one.
  assert.ok(!out.includes('href="./manifest.webmanifest"'), 'relative manifest link removed')
  assert.equal(out.match(/rel="manifest"/g).length, 1, 'exactly one manifest link')
  assert.match(out, /<link rel="manifest" href="\/manifest\.webmanifest" \/>/)

  // iOS / Android installability metas.
  assert.match(out, /<meta name="apple-mobile-web-app-capable" content="yes" \/>/)
  assert.match(out, /<meta name="mobile-web-app-capable" content="yes" \/>/)
  assert.match(out, /<link rel="apple-touch-icon" sizes="180x180" href="\/pwa\/icons\/apple-touch-icon-180\.png" \/>/)
  assert.match(out, /<link rel="icon" type="image\/png" sizes="32x32" href="\/pwa\/icons\/favicon-32\.png" \/>/)

  // The original document is otherwise untouched.
  assert.match(out, /<div id="root"><\/div>/)
  assert.match(out, /src="\.\/assets\/index-abc\.js"/)
  assert.equal(out.indexOf('<!-- dsh-pwa -->') < out.indexOf('</head>'), true, 'injected into the head')
  assert.equal(out.split('</head>').length, 2, 'head is not duplicated')

  // The inlined client script is syntactically valid and registers the worker.
  const inline = out.match(/<script>([\s\S]*?)<\/script>/)
  assert.ok(inline, 'client script inlined')
  assert.match(inline[1], /register\('\/sw\.js', \{ scope: '\/' \}\)/)
  assert.match(inline[1], /^window\.__dshPwaConfig=\{"installPrompt":true\};/,
    'config is handed to the client script')
  assert.doesNotThrow(() => new Function(inline[1]), 'inline script parses')
})

test('index tap inlines the mobile stylesheet', async () => {
  const { taps } = await mount()
  const out = taps[0]('<html><head><title>x</title></head><body></body></html>')

  const style = out.match(/<style>([\s\S]*?)<\/style>/)
  assert.ok(style, 'mobile stylesheet inlined')
  const css = style[1]
  // Comments discuss the rejected alternatives, so assertions on absence read
  // the declarations only.
  const declarations = css.replace(/\/\*[\s\S]*?\*\//g, '')

  // 16px editables are what stops Safari zooming on focus; the viewport meta
  // must stay permissive so pinch-zoom still works.
  assert.match(css, /\[contenteditable='true'\]\s*\{\s*font-size:\s*16px !important/)
  assert.ok(!declarations.includes('user-scalable=no'), 'pinch-zoom stays available')
  assert.ok(!declarations.includes('maximum-scale'), 'no maximum-scale clamp')

  // The drawer override must win against the app's inline grid-template-columns.
  assert.match(css, /\[data-dsh-pwa-frame\]:not\(\[data-sidebar-collapsed\]\)\s*\{\s*grid-template-columns:[^;]*!important/)
  assert.match(css, /position: absolute !important/)
  assert.match(css, /\[data-dsh-pwa-scrim\]/)

  // Every rule sits inside a media query, so desktop rendering is untouched.
  const unguarded = css
    .replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim()
  assert.equal(unguarded, '', 'no rule outside a media query')

  assert.equal(out.split('</head>').length, 2, 'head is not duplicated')
})

test('the client script tags the drawer and adds a dismiss surface', async () => {
  const { taps } = await mount()
  const out = taps[0]('<html><head></head><body></body></html>')
  const inline = out.match(/<script>([\s\S]*?)<\/script>/)[1]

  assert.match(inline, /data-dsh-pwa-frame/, 'frame is tagged')
  assert.match(inline, /data-dsh-pwa-sidebar-col/, 'sidebar column is tagged')
  assert.match(inline, /data-dsh-pwa-scrim/, 'scrim is created')
  assert.match(inline, /MutationObserver/, 're-tags after the app re-renders')
  assert.match(inline, /collapse sidebar/i, 'closes via the app toggle')
  assert.match(inline, /Escape/, 'Escape dismisses')
})

test('installPrompt: false reaches the client script', async () => {
  const { ctx, taps } = harness()
  apply(ctx, { installPrompt: false })
  const out = taps[0]('<html><head></head><body></body></html>')
  assert.match(out, /<script>window\.__dshPwaConfig=\{"installPrompt":false\};/)
})

test('index tap leaves a headless document untouched', async () => {
  const { taps } = await mount()
  const source = '<div id="root"></div>'
  assert.equal(taps[0](source), source)
})

test('a disabled plugin registers nothing', async () => {
  const { ctx, routes, taps } = harness()
  apply(ctx, { enabled: false })
  assert.equal(routes.length, 0)
  assert.equal(taps.length, 0)
})
