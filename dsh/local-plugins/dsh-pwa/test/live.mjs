/**
 * Live-origin check: confirms the PWA upgrade is actually serving on the public
 * HTTPS origin (behind nginx), not just on a scratch port.
 *
 * Boots headless Chrome, loads https://dsh.workofekajaya.com/, and reports the
 * manifest, installability errors, service-worker registration, cache contents,
 * and what a repeat load is answered from.
 *
 * Usage: node test/live.mjs [origin]
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ORIGIN = (process.argv[2] ?? 'https://dsh.workofekajaya.com').replace(/\/$/, '')
const CHROME = process.env.DSH_PWA_CHROME ?? '/home/personal/.agent-browser/browsers/chrome-155.0.8059.84/chrome'
const CDP_PORT = 9800 + Math.floor(Math.random() * 150)
const profile = mkdtempSync(join(tmpdir(), 'dsh-pwa-live-'))

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--no-sandbox',
  '--disable-gpu',
  '--window-size=1280,900',
], { stdio: ['ignore', 'ignore', 'ignore'] })

let ws = null
try {
  let version
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
      if (response.ok) { version = await response.json(); break }
    } catch {}
    await sleep(100)
  }
  if (version === undefined) throw new Error('chrome never started')

  ws = new WebSocket(version.webSocketDebuggerUrl)
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
  for (const domain of ['Page', 'Runtime', 'Network', 'ServiceWorker']) await send(`${domain}.enable`, {}, sessionId)

  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true,
    }, sessionId)
    if (exceptionDetails !== undefined) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
    return result.value
  }

  const fromWorker = new Set()
  on('Network.responseReceived', (params, sid) => {
    if (sid === sessionId && params.response.fromServiceWorker === true) {
      fromWorker.add(new URL(params.response.url).pathname)
    }
  })

  await send('Page.navigate', { url: `${ORIGIN}/` }, sessionId)
  await sleep(6000)

  const manifest = await send('Page.getAppManifest', {}, sessionId)
  const { installabilityErrors } = await send('Page.getInstallabilityErrors', {}, sessionId)
  const parsed = JSON.parse(manifest.data ?? '{}')

  const state = await evaluate(`(async () => {
    const ready = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
    ])
    const names = await caches.keys()
    const counts = {}
    for (const name of names) counts[name] = (await (await caches.open(name)).keys()).length
    return {
      standalone: matchMedia('(display-mode: standalone)').matches,
      controlled: Boolean(navigator.serviceWorker.controller),
      activeState: ready?.active?.state ?? null,
      scope: ready?.scope ?? null,
      script: ready?.active?.scriptURL ?? null,
      counts,
      title: document.title,
      themeColor: document.querySelector('meta[name=theme-color]')?.content ?? null,
      appleIcon: document.querySelector('link[rel=apple-touch-icon]')?.href ?? null,
      mounted: (document.body?.innerText ?? '').trim().length > 0,
    }
  })()`)

  // Mobile state, measured on the same page by switching emulation. The live
  // origin is behind nginx, and the mobile layer is pure client-side, so this is
  // the only way to confirm the deployed revision actually carries the fix.
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true }, sessionId)
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId)
  await sleep(1200)
  const mobile = await evaluate(`(() => {
    const frame = document.querySelector('[data-dsh-pwa-frame]')
    if (frame === null) return { tagged: false }
    const side = document.querySelector('[data-dsh-pwa-sidebar-col]')
    const editable = document.querySelector('[contenteditable="true"]')
    return {
      tagged: true,
      collapsed: frame.hasAttribute('data-sidebar-collapsed'),
      columns: getComputedStyle(frame).gridTemplateColumns,
      sidebarWidth: side === null ? null : Math.round(side.getBoundingClientRect().width),
      sidebarPosition: side === null ? null : getComputedStyle(side).position,
      hasScrim: document.querySelector('[data-dsh-pwa-scrim]') !== null,
      composerFontSize: editable === null ? null : getComputedStyle(editable).fontSize,
      coarsePointer: matchMedia('(pointer: coarse)').matches,
    }
  })()`)
  await send('Emulation.clearDeviceMetricsOverride', {}, sessionId)
  await send('Emulation.setTouchEmulationEnabled', { enabled: false }, sessionId)

  console.log(JSON.stringify({
    origin: ORIGIN,
    manifestUrl: manifest.url,
    manifestErrors: manifest.errors ?? [],
    installabilityErrors,
    manifestName: parsed.name,
    themeColorDeclared: parsed.theme_color,
    iconCount: (parsed.icons ?? []).length,
    ...state,
    mobile,
  }, null, 2))

  // Reload to see the worker answer.
  fromWorker.clear()
  await send('Page.reload', {}, sessionId)
  await sleep(5000)
  console.log(`\nsecond load served from worker: ${fromWorker.size} responses`)
  console.log([...fromWorker].sort().join('\n'))
} finally {
  ws?.close()
  chrome.kill('SIGKILL')
  rmSync(profile, { recursive: true, force: true })
}
