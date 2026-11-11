// Raw-CDP probe: authenticate, open the System monitor panel, report the DOM
// state it produced, and save a screenshot.
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire('/home/personal/.dsh/profiles/web/package.json')
const WebSocket = require('ws')

const BASE = process.argv[2]
const TOKEN = process.argv[3]
const OUT = process.argv[4] ?? '/home/personal/dsh-system-monitor/scripts/monitor.png'
const PORT = 9341

const profile = mkdtempSync(join(tmpdir(), 'sm-chrome-'))
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
  throw new Error('chrome devtools did not come up')
}

const browser = new WebSocket(await debuggerUrl())
await new Promise((done) => browser.once('open', done))

let nextId = 1
const pending = new Map()
const consoleLines = []
const pageErrors = []

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
  if (message.method === 'Runtime.consoleAPICalled') {
    consoleLines.push(`${message.params.type}: ${(message.params.args ?? []).map((arg) => arg.value ?? arg.description ?? arg.type).join(' ')}`)
    return
  }
  if (message.method === 'Runtime.exceptionThrown') {
    const details = message.params.exceptionDetails
    pageErrors.push(details.exception?.description ?? details.text)
  }
})

const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
const call = (method, params) => send(method, params, sessionId)
await call('Runtime.enable')
await call('Page.enable')

await call('Page.navigate', { url: `${BASE}/?token=${TOKEN}` })
await sleep(9000)

async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
  if (result.exceptionDetails !== undefined) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  }
  return result.result.value
}

const report = { probes: {} }
report.probes.loaded = await evaluate('Boolean(window.__DSH_BOOT__)')
report.probes.style = await evaluate(`(() => {
  const tag = document.querySelector('style[data-plugin-css="dsh-system-monitor/client.css"]');
  return { present: tag !== null, bytes: tag === null ? 0 : tag.textContent.length };
})()`)

// Click the sidebar entry whose label is the plugin's panel label.
report.probes.clicked = await evaluate(`(() => {
  const nodes = [...document.querySelectorAll('button, [role="button"], a')];
  const target = nodes.find((node) => /System|系统监视器/.test((node.getAttribute('title') ?? '') + ' ' + node.textContent));
  if (target === undefined) return { found: false, candidates: nodes.map((n) => n.getAttribute('title')).filter(Boolean).slice(0, 40) };
  target.click();
  return { found: true, label: (target.getAttribute('title') ?? target.textContent).trim() };
})()`)
await sleep(4500)

report.probes.page = await evaluate(`(() => {
  const page = document.querySelector('.sm-page');
  if (page === null) return { rendered: false, bodyText: document.body.innerText.slice(0, 400) };
  const cards = [...page.querySelectorAll('.sm-card-title')].map((node) => node.textContent);
  const figures = [...page.querySelectorAll('.sm-figure')].map((node) => node.textContent);
  const bars = page.querySelectorAll('.sm-bar-fill').length;
  const cores = page.querySelectorAll('.sm-core').length;
  const rows = page.querySelectorAll('.sm-table tbody tr').length;
  const paths = [...page.querySelectorAll('.sm-spark-line')].map((node) => (node.getAttribute('d') ?? '').slice(0, 24));
  return {
    rendered: true, cards, figures, bars, cores, rows, paths,
    note: (page.querySelector('.sm-sub') ?? {}).textContent ?? '',
    width: page.getBoundingClientRect().width,
  };
})()`)

// A second poll must move the sparkline and refresh the figures.
await sleep(4500)
report.probes.afterSecondPoll = await evaluate(`(() => {
  const page = document.querySelector('.sm-page');
  if (page === null) return { rendered: false };
  return {
    sparkPoints: [...page.querySelectorAll('.sm-spark-line')].map((node) => (node.getAttribute('d') ?? '').split('L').length),
    figures: [...page.querySelectorAll('.sm-figure')].map((node) => node.textContent),
  };
})()`)

const shot = await call('Page.captureScreenshot', { format: 'png' })
writeFileSync(OUT, Buffer.from(shot.data, 'base64'))
report.screenshot = OUT
report.console = consoleLines.slice(-30)
report.pageErrors = pageErrors.slice(-10)
console.log(JSON.stringify(report, null, 2))

browser.close()
chrome.kill('SIGKILL')
rmSync(profile, { recursive: true, force: true })
