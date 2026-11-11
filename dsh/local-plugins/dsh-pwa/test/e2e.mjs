/**
 * End-to-end PWA verification for the DSH Web GUI, driven over CDP.
 *
 * Boots its own throwaway `dsh web` instance on a scratch port, then checks —
 * in a real Chrome:
 *
 *   • the manifest is fetched, parsed, and passes Chrome's installability check
 *   • the index head carries the manifest / iOS metas / apple-touch-icon
 *   • the service worker registers, activates, and controls the page
 *   • shell assets are precached and /assets fill their cache
 *   • a repeat load answers the bundle from the worker (not the network)
 *   • with the server *actually stopped*, a navigation lands on the offline page
 *
 * The scratch instance boots the same profile as the live one (so it loads the
 * real plugin stack) on a different port; nothing is written outside the
 * Chrome temp dir.
 *
 * Usage: node test/e2e.mjs [--keep] [--port 3099]
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = process.env.DSH_PWA_CHROME ?? '/home/personal/.agent-browser/browsers/chrome-155.0.8059.84/chrome'
const DSH = process.env.DSH_PWA_DSH ?? 'dsh'
const KEEP = process.argv.includes('--keep')
const portIndex = process.argv.indexOf('--port')
const APP_PORT = portIndex === -1 ? 3200 + Math.floor(Math.random() * 300) : Number(process.argv[portIndex + 1])
const CDP_PORT = 9400 + Math.floor(Math.random() * 400)

const chromeProfile = mkdtempSync(join(tmpdir(), 'pwa-chrome-'))

/** Collected pass/fail lines. */
const results = []
/**
 * Record one assertion.
 * @param {string} label - what is being checked.
 * @param {boolean} ok - outcome.
 * @param {string} [detail] - extra context.
 */
function check(label, ok, detail = '') {
  results.push({ label, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === '' ? '' : `  — ${detail}`}`)
}

/** Sleep helper. */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let app = null
let chrome = null
let cdp = null
let exitCode = 0

/**
 * Boot `dsh web` on the scratch port and resolve once it prints its token URL.
 * @returns {Promise<{ url: string, origin: string }>} booted address.
 */
async function bootApp() {
  app = spawn(DSH, ['web', '--port', String(APP_PORT), '--no-open'], { stdio: ['ignore', 'pipe', 'pipe'] })
  const chunks = []
  const onData = (buffer) => chunks.push(buffer.toString())
  app.stdout.on('data', onData)
  app.stderr.on('data', onData)
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const match = /(https?:\/\/[^\s]+\?token=[A-Za-z0-9_-]+)/.exec(chunks.join(''))
    if (match !== null) {
      const url = match[1]
      return { url, origin: new URL(url).origin }
    }
    if (app.exitCode !== null) throw new Error(`dsh exited early: ${chunks.join('').slice(-800)}`)
    await sleep(150)
  }
  throw new Error(`dsh never printed a URL: ${chunks.join('').slice(-800)}`)
}

/**
 * Launch headless Chrome and attach a flat CDP session to one page.
 * @returns {Promise<{ send: Function, on: Function, close: Function, sessionId: string, navigate: Function, evaluate: Function }>} session.
 */
async function bootChrome() {
  chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${chromeProfile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    // The host blocks unprivileged user namespaces, so Chrome's own sandbox
    // cannot start; this profile only ever loads the throwaway local instance.
    '--no-sandbox',
    '--window-size=1280,900',
  ], { stdio: ['ignore', 'ignore', 'ignore'] })

  let version
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
      if (response.ok) {
        version = await response.json()
        break
      }
    } catch {}
    await sleep(100)
  }
  if (version === undefined) throw new Error('chrome devtools never came up')

  const ws = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })

  let nextId = 0
  const pending = new Map()
  const listeners = new Map()
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id !== undefined) {
      const entry = pending.get(message.id)
      if (entry === undefined) return
      pending.delete(message.id)
      if (message.error !== undefined) entry.reject(new Error(JSON.stringify(message.error)))
      else entry.resolve(message.result)
      return
    }
    for (const handler of listeners.get(message.method) ?? []) handler(message.params, message.sessionId)
  })
  const send = (method, params = {}, sessionId = null) => {
    const id = (nextId += 1)
    const payload = { id, method, params }
    if (sessionId !== null) payload.sessionId = sessionId
    ws.send(JSON.stringify(payload))
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
  }
  const on = (method, handler) => {
    const list = listeners.get(method) ?? []
    list.push(handler)
    listeners.set(method, list)
  }

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  for (const domain of ['Page', 'Runtime', 'Network', 'ServiceWorker']) {
    await send(`${domain}.enable`, {}, sessionId)
  }

  /**
   * Navigate the page, optionally waiting for a load event plus a settle.
   * @param {string} url - target URL.
   * @param {boolean} [expectLoad] - wait for a load event.
   * @returns {Promise<void>} resolves once settled.
   */
  const navigate = async (url, expectLoad = true) => {
    const loaded = expectLoad
      ? new Promise((resolve) => {
        const timer = setTimeout(resolve, 25000)
        const handler = (params, sid) => {
          if (sid !== sessionId) return
          clearTimeout(timer)
          resolve()
        }
        on('Page.loadEventFired', handler)
      })
      : Promise.resolve()
    await send('Page.navigate', { url }, sessionId)
    await loaded
    await sleep(1800)
  }

  /**
   * Evaluate an expression in the page.
   * @param {string} expression - JS source (may await).
   * @returns {Promise<any>} the value.
   */
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    }, sessionId)
    if (exceptionDetails !== undefined) {
      throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text ?? 'evaluate failed')
    }
    return result.value
  }

  /**
   * Dismiss any modal that a fresh browser profile stacks over the app.
   *
   * The API-key onboarding only mounts a few seconds after the app boots, so a
   * single check straight after load misses it and every later measurement is
   * taken against the dialog's backdrop instead of the real layout. Poll until
   * the dialogs stop appearing.
   * @returns {Promise<boolean>} whether the document is dialog-free at the end.
   */
  const dismissDialogs = async () => {
    let quiet = 0
    for (let attempt = 0; attempt < 24 && quiet < 3; attempt += 1) {
      const clicked = await evaluate(`(() => {
        const dialog = document.querySelector('[role="dialog"]')
        if (dialog === null) return null
        const button = [...dialog.querySelectorAll('button')]
          .find((node) => /^(continue|configure later|save and continue|got it|close)$/i.test((node.textContent ?? '').trim()))
        button?.click()
        return button === undefined ? 'no-dismiss-button' : button.textContent.trim()
      })()`)
      quiet = clicked === null ? quiet + 1 : 0
      await sleep(600)
    }
    return await evaluate('document.querySelector(\'[role="dialog"]\') === null')
  }

  return { send, on, close: () => ws.close(), sessionId, navigate, evaluate, dismissDialogs }
}

try {
  const { url, origin } = await bootApp()
  const session = await bootChrome()
  cdp = session
  const { sessionId, navigate, evaluate, dismissDialogs } = session

  await navigate(url)

  const manifest = await cdp.send('Page.getAppManifest', {}, sessionId)
  check('manifest is fetched by the browser', manifest.url === `${origin}/manifest.webmanifest`, manifest.url ?? 'none')
  check('manifest has no parse errors', (manifest.errors ?? []).length === 0, JSON.stringify(manifest.errors ?? []))

  const parsed = JSON.parse(manifest.data ?? '{}')
  check('manifest name', parsed.name === 'DeepSeek Harness', parsed.name)
  check('manifest display standalone', parsed.display === 'standalone', parsed.display)
  check('manifest theme_color', parsed.theme_color === '#0f1115', parsed.theme_color)
  check('manifest start_url/scope at origin root', parsed.start_url === '/' && parsed.scope === '/',
    `${parsed.start_url} / ${parsed.scope}`)
  check('manifest has maskable icon', (parsed.icons ?? []).some((icon) => icon.purpose?.includes('maskable')))

  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors', {}, sessionId)
  check('zero installability errors', installabilityErrors.length === 0, JSON.stringify(installabilityErrors))

  const head = await evaluate(`(() => ({
    manifest: document.querySelector('link[rel=manifest]')?.getAttribute('href') ?? null,
    manifestCount: document.querySelectorAll('link[rel=manifest]').length,
    manifestHref: document.querySelector('link[rel=manifest]')?.href ?? null,
    appleCapable: document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.content ?? null,
    appleTitle: document.querySelector('meta[name="apple-mobile-web-app-title"]')?.content ?? null,
    appleStatus: document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.content ?? null,
    mobileCapable: document.querySelector('meta[name="mobile-web-app-capable"]')?.content ?? null,
    appleIcon: document.querySelector('link[rel=apple-touch-icon]')?.getAttribute('href') ?? null,
    pngFavicon: document.querySelector('link[rel="icon"][type="image/png"]')?.getAttribute('href') ?? null,
    themeColor: document.querySelector('meta[name=theme-color]')?.content ?? null,
    appMounted: document.body.innerText.trim().length > 0,
  }))()`)
  check('head links the absolute manifest', head.manifest === '/manifest.webmanifest', String(head.manifest))
  check('manifest resolves at the origin root', head.manifestHref === `${origin}/manifest.webmanifest`, String(head.manifestHref))
  check('exactly one manifest link', head.manifestCount === 1, String(head.manifestCount))
  check('iOS capable metas present', head.appleCapable === 'yes' && head.mobileCapable === 'yes'
    && head.appleStatus === 'default', `${head.appleCapable} / ${head.mobileCapable} / ${head.appleStatus}`)
  check('iOS title present', head.appleTitle === 'DSH', String(head.appleTitle))
  check('apple-touch-icon present', head.appleIcon === '/pwa/icons/apple-touch-icon-180.png', String(head.appleIcon))
  check('PNG favicon present', head.pngFavicon === '/pwa/icons/favicon-32.png', String(head.pngFavicon))
  check('theme-color meta present', head.themeColor !== null, String(head.themeColor))
  check('app mounted after the head rewrite', head.appMounted === true)

  const registration = await evaluate(`(async () => {
    const reg = await navigator.serviceWorker.ready
    return { scope: reg.scope, state: reg.active?.state ?? null, script: reg.active?.scriptURL ?? null }
  })()`)
  check('service worker scope is the origin root', registration.scope === `${origin}/`, registration.scope)
  check('service worker is activated', registration.state === 'activated', String(registration.state))
  check('service worker script is /sw.js', registration.script === `${origin}/sw.js`, String(registration.script))

  // Second load: the worker now controls the page, so it answers the shell from
  // its caches instead of hitting the server. Chrome flags those responses with
  // `fromServiceWorker`.
  const fromWorker = new Set()
  cdp.on('Network.responseReceived', (params, sid) => {
    if (sid !== sessionId) return
    const response = params.response
    if (response.fromServiceWorker === true) fromWorker.add(new URL(response.url).pathname)
  })
  await navigate(url)

  const controlled = await evaluate('Boolean(navigator.serviceWorker.controller)')
  check('page is controlled by the worker', controlled === true)

  const cacheState = await evaluate(`(async () => {
    const names = await caches.keys()
    const detail = {}
    for (const name of names) {
      const cache = await caches.open(name)
      detail[name] = (await cache.keys()).map((request) => new URL(request.url).pathname)
    }
    return detail
  })()`)
  const byPrefix = (prefix) => Object.entries(cacheState)
    .filter(([key]) => key.startsWith(prefix))
    .flatMap(([, value]) => value)
  const shells = byPrefix('dsh-pwa-shell-')
  const assets = byPrefix('dsh-pwa-assets-')
  check('shell cache precached the offline page', shells.includes('/pwa/offline.html'), JSON.stringify(shells))
  check('shell cache precached the icons',
    shells.includes('/pwa/icons/icon-192.png') && shells.includes('/pwa/icons/icon-512.png'))
  check('asset cache holds the frontend JS bundle', assets.some((path) => path.endsWith('.js')), JSON.stringify(assets))
  check('asset cache holds the CSS', assets.some((path) => path.endsWith('.css')), `${assets.length} entries`)
  check('repeat load is answered from the worker', fromWorker.size >= 2, `${fromWorker.size} requests`)
  check('nothing under /api is cached', !Object.values(cacheState).flat().some((path) => path.startsWith('/api/')))
  const cacheNames = Object.keys(cacheState).sort()
  check('cache names are versioned', cacheNames.length === 3 && cacheNames.every((key) => /-[0-9a-f]{12}$/.test(key)),
    cacheNames.join(', '))

  // ── Desktop regression ───────────────────────────────────────────────────
  // The drawer rules live in a max-width media query, so a wide viewport must
  // look exactly as it did before the mobile work: sidebar in its own grid
  // track, no scrim, nothing absolutely positioned.
  const desktop = await evaluate(`(() => {
    const frame = document.querySelector('[data-dsh-pwa-frame]')
    const column = document.querySelector('[data-dsh-pwa-sidebar-col]')
    const scrim = document.querySelector('[data-dsh-pwa-scrim]')
    const box = column?.getBoundingClientRect()
    return {
      tagged: frame !== null && column !== null,
      position: column === null ? null : getComputedStyle(column).position,
      width: box === undefined ? null : Math.round(box.width),
      scrimShown: scrim !== null && getComputedStyle(scrim).display !== 'none',
    }
  })()`)
  check('the frame is tagged on desktop too', desktop.tagged === true)
  check('desktop keeps the sidebar in normal flow', desktop.position === 'static', String(desktop.position))
  check('desktop sidebar keeps its own width', desktop.width === 280, String(desktop.width))
  check('the scrim is hidden on desktop', desktop.scrimShown === false)

  // ── Mobile layout ────────────────────────────────────────────────────────
  // Re-run the same page at phone size with touch emulation. The checks below
  // are the ones the reported complaints map to: no focus zoom, a sidebar that
  // overlays instead of crushing the conversation, and a way to dismiss it.
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 3, mobile: true,
  }, sessionId)
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId)
  await navigate(url)

  // A first-run dialog can cover the app in a fresh profile (the API-key
  // onboarding, and sometimes a preview notice). Dismiss whatever is stacked
  // there so the measurements below describe the real layout.
  const dialogGone = await dismissDialogs()
  check('first-run dialog dismissed for mobile measurements', dialogGone === true)

  const mobile = await evaluate(`(() => {
    const frame = document.querySelector('[data-dsh-pwa-frame]')
    const column = document.querySelector('[data-dsh-pwa-sidebar-col]')
    const composer = document.querySelector('[contenteditable="true"]')
    return {
      tagged: frame !== null && column !== null,
      collapsed: frame?.hasAttribute('data-sidebar-collapsed') ?? null,
      columns: frame === null ? null : getComputedStyle(frame).gridTemplateColumns,
      composerFont: composer === null ? null : getComputedStyle(composer).fontSize,
      coarse: window.matchMedia('(pointer: coarse)').matches,
      viewport: document.querySelector('meta[name=viewport]')?.content ?? null,
      scrim: document.querySelector('[data-dsh-pwa-scrim]') !== null,
    }
  })()`)
  check('the plugin tags the layout frame and sidebar column', mobile.tagged === true)
  check('touch emulation is reported as a coarse pointer', mobile.coarse === true)
  check('composer is at least 16px on touch (no iOS focus zoom)', mobile.composerFont === '16px',
    String(mobile.composerFont))
  check('viewport keeps pinch-zoom enabled', mobile.viewport !== null
    && !/user-scalable=no|maximum-scale/.test(mobile.viewport), String(mobile.viewport))
  check('a dismiss scrim exists', mobile.scrim === true)
  check('the drawer starts collapsed', mobile.collapsed === true, String(mobile.collapsed))

  // Open the drawer and measure: the conversation must keep its full width and
  // the drawer must sit above it.
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')]
      .find((node) => /^open sidebar$/i.test((node.getAttribute('aria-label') ?? '').trim()))
    button?.click()
    return button !== undefined && button !== null
  })()`)
  await sleep(700)

  const open = await evaluate(`(() => {
    const frame = document.querySelector('[data-dsh-pwa-frame]')
    const column = document.querySelector('[data-dsh-pwa-sidebar-col]')
    const scrim = document.querySelector('[data-dsh-pwa-scrim]')
    // The [data-slot=main] node is a zero-size pass-through; its parent is the
    // real grid column that carries the conversation's width.
    const center = document.querySelector('[data-dsh-pwa-center-col]')
    const box = column?.getBoundingClientRect()
    const style = column === null ? null : getComputedStyle(column)
    const centerBox = center?.getBoundingClientRect()
    return {
      collapsed: frame?.hasAttribute('data-sidebar-collapsed'),
      columns: frame === null ? null : getComputedStyle(frame).gridTemplateColumns,
      position: style?.position ?? null,
      width: box === undefined ? null : Math.round(box.width),
      left: box === undefined ? null : Math.round(box.left),
      zIndex: style?.zIndex ?? null,
      centerWidth: centerBox === undefined ? null : Math.round(centerBox.width),
      centerLeft: centerBox === undefined ? null : Math.round(centerBox.left),
      mainWidth: centerBox === undefined ? null : Math.round(centerBox.width),
      scrimShown: scrim !== null && getComputedStyle(scrim).display === 'block',
      scrimHitTest: scrim !== null && document.elementFromPoint(350, 400) === scrim,
      // What a finger lands on *inside* the drawer body. A mask painted above
      // the drawer answers here instead of the drawer's own content.
      drawerHitTest: box === undefined || box === null ? null : (() => {
        const hit = document.elementFromPoint(Math.round(box.x + box.width / 2), Math.round(box.y + box.height - 60))
        if (hit === null || column === null) return null
        return {
          inside: column.contains(hit),
          top: hit.tagName.toLowerCase() + '.' + String(hit.getAttribute('class') ?? '').split(' ')[0],
        }
      })(),
    }
  })()`)
  const columnTrack = (open.columns ?? '').split(' ')[0]
  check('opening the drawer keeps the content track at rail width', columnTrack === '56px',
    String(open.columns))
  check('the conversation keeps the full viewport width', open.centerWidth === 334,
    `${open.centerWidth} at x=${open.centerLeft}`)
  check('the conversation is not pushed into the rail track', open.centerLeft === 56,
    String(open.centerLeft))
  check('the drawer is taken out of flow', open.position === 'absolute', String(open.position))
  check('the drawer is narrower than the viewport', open.width !== null && open.width < 360, String(open.width))
  check('the drawer sits above content', Number(open.zIndex) >= 50, String(open.zIndex))
  // Stacking order is not a cosmetic preference: the app paints its own scrim
  // at z-index 70 and expects the sidebar at 71, so any drawer layer below the
  // scrim swallows every touch — the session list cannot be dragged and its
  // rows cannot be tapped. Assert the real symptom (what a fingertip hits
  // inside the drawer), not the number, so a future z-index change has to keep
  // the list reachable rather than merely clearing a threshold.
  check('touches inside the drawer reach the session list, not a mask',
    open.drawerHitTest !== null && open.drawerHitTest.inside === true,
    JSON.stringify(open.drawerHitTest))
  check('the scrim is shown while the drawer is open', open.scrimShown === true)
  check('taps beside the drawer land on the scrim', open.scrimHitTest === true)

  // The user-visible symptom: a finger dragged up the session list must scroll
  // it. This is the assertion that fails when the drawer sits under the mask —
  // the hit test above catches the routing, this catches the outcome.
  const listBefore = await evaluate(`(() => {
    const list = document.querySelector('[data-dsh-pwa-sidebar-col] [class*="list"][class*="scroll"], [data-dsh-pwa-sidebar-col] [style*="overflow"]')
    const node = list ?? [...document.querySelectorAll('[data-dsh-pwa-sidebar-col] *')]
      .find((el) => el.scrollHeight > el.clientHeight + 20 && /(auto|scroll)/.test(getComputedStyle(el).overflowY))
    return node === undefined || node === null ? null : { top: Math.round(node.scrollTop) }
  })()`)
  if (listBefore !== null) {
    // Drag from the lower half of the drawer up past its top edge.
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: [{ x: 140, y: 720 }],
    }, sessionId)
    for (let step = 1; step <= 24; step++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: [{ x: 140, y: 720 - step * 10 }],
      }, sessionId)
      await sleep(16)
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, sessionId)
    await sleep(500)
  }
  const listAfter = listBefore === null ? null : await evaluate(`(() => {
    const list = document.querySelector('[data-dsh-pwa-sidebar-col] [class*="list"][class*="scroll"], [data-dsh-pwa-sidebar-col] [style*="overflow"]')
    const node = list ?? [...document.querySelectorAll('[data-dsh-pwa-sidebar-col] *')]
      .find((el) => el.scrollHeight > el.clientHeight + 20 && /(auto|scroll)/.test(getComputedStyle(el).overflowY))
    return node === undefined || node === null ? null : { top: Math.round(node.scrollTop) }
  })()`)
  check('dragging up the drawer scrolls the session list',
    listAfter !== null && listAfter.top > listBefore.top,
    `${listBefore?.top} -> ${listAfter?.top}`)

  // A tap on the scrim must close the drawer.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 350, y: 400 }] }, sessionId)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, sessionId)
  await sleep(700)
  const afterScrimTap = await evaluate(
    `document.querySelector('[data-dsh-pwa-frame]')?.hasAttribute('data-sidebar-collapsed') ?? null`,
  )
  check('tapping the scrim closes the drawer', afterScrimTap === true, String(afterScrimTap))

  // Escape must close it too, for keyboard and hardware keyboards on tablets.
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')]
      .find((node) => /^open sidebar$/i.test((node.getAttribute('aria-label') ?? '').trim()))
    button?.click()
    return true
  })()`)
  await sleep(500)
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27,
  }, sessionId)
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27,
  }, sessionId)
  await sleep(700)
  const afterEscape = await evaluate(
    `document.querySelector('[data-dsh-pwa-frame]')?.hasAttribute('data-sidebar-collapsed') ?? null`,
  )
  check('Escape closes the drawer', afterEscape === true, String(afterEscape))

  // Touch targets: a fingertip needs ~44px of hit area. Measure it the way a
  // finger does — hit-test 20px above and below each control's centre and see
  // whether the control itself answers.
  const targets = await evaluate(`(() => {
    const report = []
    for (const node of document.querySelectorAll('[data-dsh-pwa-sidebar-col] button, [data-slot="sidebar"] button')) {
      const box = node.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) continue
      const cx = box.x + box.width / 2
      const cy = box.y + box.height / 2
      const hits = [-20, 0, 20].map((dy) => {
        const hit = document.elementFromPoint(cx, cy + dy)
        return hit !== null && (hit === node || node.contains(hit))
      })
      const centre = document.elementFromPoint(cx, cy)
      const label = (node.getAttribute('aria-label') ?? node.textContent ?? '').trim().slice(0, 24)
      report.push({
        label,
        w: Math.round(box.width),
        h: Math.round(box.height),
        hits,
        // Diagnose the top of the stack when the centre is not the button.
        top: centre === null || hits[1] ? null
          : \`\${centre.tagName.toLowerCase()}.\${(centre.getAttribute('class') ?? '').split(' ')[0]}\`,
      })
    }
    return report
  })()`)
  const smallTargets = targets.filter((entry) => entry.hits.some((hit) => hit === false))
  check('sidebar controls expose a fingertip-sized hit area', smallTargets.length === 0,
    JSON.stringify(smallTargets))

  // The composer row is the other thumb-heavy surface: workspace picker, mode
  // picker, attach, access mode, experts, model and send. It must reach 44px
  // tall without overflowing the 390px viewport.
  const composer = await evaluate(`(() => {
    const seat = document.querySelector('[data-slot="conversation.composer"]')
    if (seat === null) return { missing: true }
    const scope = seat.closest('[class*="_composerSeat"]') ?? seat.parentElement
    const report = []
    for (const node of scope.querySelectorAll('button')) {
      const box = node.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) continue
      const cx = box.x + box.width / 2
      const cy = box.y + box.height / 2
      report.push({
        label: (node.getAttribute('aria-label') ?? node.textContent ?? '').trim().slice(0, 24),
        h: Math.round(box.height),
        hits: [-20, 0, 20].map((dy) => {
          const hit = document.elementFromPoint(cx, cy + dy)
          return hit !== null && (hit === node || node.contains(hit))
        }),
      })
    }
    return {
      report,
      pageWidth: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
      overflowing: [...scope.querySelectorAll('*')]
        .filter((node) => node.scrollWidth > node.clientWidth + 2 && node.clientWidth > 0)
        .map((node) => String(node.getAttribute('class') ?? node.tagName).split(' ')[0]),
    }
  })()`)
  const smallComposer = composer.missing === true
    ? ['composer not found']
    : composer.report.filter((entry) => entry.hits.some((hit) => hit === false))
  check('composer controls expose a fingertip-sized hit area', smallComposer.length === 0,
    JSON.stringify(smallComposer))
  check('composer still fits the viewport', composer.missing !== true
    && composer.pageWidth <= composer.viewport
    && composer.overflowing.length === 0,
  `page ${composer.pageWidth} / viewport ${composer.viewport} / overflowing ${JSON.stringify(composer.overflowing)}`)

  // The install/update chip is the one floating surface the plugin adds itself.
  // A synthetic `beforeinstallprompt` makes the client render it, so its real
  // geometry can be measured: on a phone it must be thumb-sized and must not sit
  // on top of the bottom bar controls.
  const chip = await evaluate(`(() => {
    window.dispatchEvent(new Event('beforeinstallprompt', { cancelable: true }))
    const nodes = [...document.querySelectorAll('body > button')]
    const node = nodes.reverse().find((n) => /install app/i.test(n.textContent ?? ''))
    if (node === undefined) return { missing: true }
    const box = node.getBoundingClientRect()
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
    return {
      label: node.textContent,
      rect: [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)],
      hitTest: hit !== null && (hit === node || node.contains(hit)),
      insideViewport: box.x >= 0 && box.y >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight,
      // The settings button and the bottom-panel row live in the last ~60px.
      clearsBottomBar: box.bottom <= window.innerHeight - 60,
    }
  })()`)
  check('a rendered chip is thumb-sized and clears the bottom bar', chip.missing !== true
    && chip.rect[3] >= 44
    && chip.hitTest === true
    && chip.insideViewport === true
    && chip.clearsBottomBar === true,
  JSON.stringify(chip))
  await evaluate('(() => { document.querySelectorAll("body > button").forEach((n) => n.remove()); return true })()')

  // Restore desktop emulation before the offline check, which is size-agnostic.
  await cdp.send('Emulation.clearDeviceMetricsOverride', {}, sessionId)
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false }, sessionId)

  // True offline: stop the server, then navigate. The worker must answer.
  app.kill('SIGTERM')
  await sleep(1500)
  await cdp.send('Network.emulateNetworkConditions', {
    offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
  }, sessionId)
  await navigate(url, false)
  const offline = await evaluate(`({
    title: document.title,
    text: (document.body?.innerText ?? '').replace(/\\s+/g, ' ').slice(0, 80),
    retry: Boolean(document.getElementById('retry')),
  })`)
  check('offline navigation lands on the offline page', /offline/i.test(offline.title), `${offline.title} :: ${offline.text}`)
  check('offline page offers a retry', offline.retry === true)

  cdp.close()
} catch (error) {
  console.error('HARNESS ERROR', error)
  exitCode = 1
} finally {
  if (!KEEP) {
    chrome?.kill('SIGKILL')
    app?.kill('SIGKILL')
    rmSync(chromeProfile, { recursive: true, force: true })
  }
}

const failed = results.filter((entry) => !entry.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length > 0) {
  exitCode = 1
  for (const entry of failed) console.log(`  FAILED: ${entry.label} — ${entry.detail}`)
}
process.exit(exitCode)
