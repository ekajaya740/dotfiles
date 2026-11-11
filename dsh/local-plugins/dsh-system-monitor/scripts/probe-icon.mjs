// Raw-CDP probe: the sidebar icon of the System panel — size, geometry, theme
// colour and the selected state.
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire('/home/personal/.dsh/profiles/web/package.json')
const WebSocket = require('ws')
const BASE = process.argv[2]
const TOKEN = process.argv[3]
const OUT = process.argv[4] ?? '/home/personal/dsh-system-monitor/scripts/icon.png'
const PORT = 9347

const profile = mkdtempSync(join(tmpdir(), 'sm-icon-'))
const chrome = spawn('/home/personal/.agent-browser/browsers/chrome-155.0.8059.84/chrome', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--hide-scrollbars', '--window-size=1440,1000',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] })
chrome.stderr.on('data', () => {})
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

async function debuggerUrl() {
  for (let index = 0; index < 160; index += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (response.ok) return (await response.json()).webSocketDebuggerUrl
    } catch {}
    await sleep(250)
  }
  throw new Error('devtools unavailable')
}

const browser = new WebSocket(await debuggerUrl())
await new Promise((done) => browser.once('open', done))
let nextId = 1
const pending = new Map()
const errors = []
function send(method, params = {}, sessionId) {
  const id = nextId++
  browser.send(JSON.stringify({ id, method, params, ...(sessionId === undefined ? {} : { sessionId }) }))
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
}
browser.on('message', (raw) => {
  const message = JSON.parse(raw.toString())
  if (message.id !== undefined) {
    const slot = pending.get(message.id)
    pending.delete(message.id)
    if (slot === undefined) return
    if (message.error !== undefined) slot.reject(new Error(JSON.stringify(message.error)))
    else slot.resolve(message.result)
    return
  }
  if (message.method === 'Runtime.exceptionThrown') {
    errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
  }
})

const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
const call = (method, params) => send(method, params, sessionId)
await call('Runtime.enable')
await call('Page.enable')
await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 2, mobile: false })
await call('Page.navigate', { url: `${BASE}/?token=${TOKEN}` })
await sleep(9000)

async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
  if (result.exceptionDetails !== undefined) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}

const INSPECT = `(() => {
  const span = document.querySelector('.sm-icon');
  if (span === null) return { found: false };
  const button = span.closest('button, [role="button"]');
  const svg = span.querySelector('svg');
  const bbox = svg.getBBox();
  const box = span.getBoundingClientRect();
  const svgBox = svg.getBoundingClientRect();
  const colour = getComputedStyle(span).color;
  return {
    found: true,
    label: (button?.getAttribute('aria-label') ?? button?.getAttribute('title') ?? button?.textContent ?? '').trim(),
    selected: span.closest('[aria-current="page"], [aria-selected="true"], [data-active="true"]') !== null
      || button?.getAttribute('aria-current') === 'page',
    box: { w: Math.round(box.width), h: Math.round(box.height) },
    svgBox: { w: Math.round(svgBox.width), h: Math.round(svgBox.height) },
    overflow: box.width < svgBox.width || box.height < svgBox.height,
    glyph: { x: +bbox.x.toFixed(2), y: +bbox.y.toFixed(2), w: +bbox.width.toFixed(2), h: +bbox.height.toFixed(2) },
    viewBox: svg.getAttribute('viewBox'),
    insideViewBox: bbox.x >= 0 && bbox.y >= 0 && bbox.x + bbox.width <= 16.001 && bbox.y + bbox.height <= 16.001,
    stroke: getComputedStyle(svg.querySelector('path')).stroke,
    colour,
    dialOpacity: getComputedStyle(svg.querySelector('.sm-icon-dial')).opacity,
    paths: svg.querySelectorAll('path').length,
    dataActive: span.getAttribute('data-active'),
  };
})()`

const report = {}
report.before = await evaluate(INSPECT)

// Selecting the panel must not change the glyph's box or colours in a broken way.
await evaluate(`(() => {
  const span = document.querySelector('.sm-icon');
  (span.closest('button, [role="button"]') ?? span).click();
})()`)
await sleep(3500)
report.after = await evaluate(INSPECT)
report.panelVisible = await evaluate(`document.querySelector('.sm-page') !== null`)

const shot = await call('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 280, height: 420, scale: 3 } })
writeFileSync(OUT, Buffer.from(shot.data, 'base64'))
report.screenshot = OUT
report.errors = errors.slice(-5)
console.log(JSON.stringify(report, null, 2))

browser.close()
chrome.kill('SIGKILL')
rmSync(profile, { recursive: true, force: true })
