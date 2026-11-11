// Raw-CDP probe of the LIVE server: inject the auth cookie, open the panel, and
// report DOM state + console/network failures. Read-only diagnosis.
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire('/home/personal/.dsh/profiles/web/package.json')
const WebSocket = require('ws')

const BASE = process.argv[2]
const COOKIE = process.argv[3]
const PORT = 9461

const profile = mkdtempSync(join(tmpdir(), 'sm-live-'))
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
const failed = []

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
    consoleLines.push(`${message.params.type}: ${(message.params.args ?? []).map((arg) => arg.value ?? arg.description ?? arg.type).join(' ').slice(0, 300)}`)
    return
  }
  if (message.method === 'Runtime.exceptionThrown') {
    pageErrors.push((message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text).slice(0, 400))
    return
  }
  if (message.method === 'Network.responseReceived') {
    const { response } = message.params
    if (response.status >= 400) failed.push(`${response.status} ${response.url.slice(0, 160)}`)
  }
})

const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
const call = (method, params) => send(method, params, sessionId)
await call('Runtime.enable')
await call('Page.enable')
await call('Network.enable')

const [name, value] = COOKIE.split('=')
const host = new URL(BASE)
await call('Network.setCookie', { name, value, domain: host.hostname, path: '/', httpOnly: true, sameSite: 'Strict' })

await call('Page.navigate', { url: `${BASE}/` })
await sleep(10000)

async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
  if (result.exceptionDetails !== undefined) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}

const report = {}
report.booted = await evaluate('Boolean(window.__DSH_BOOT__)')
report.sidebarChips = await evaluate(`[...document.querySelectorAll('button,[role="button"]')].map(n=>(n.getAttribute('title')??'').trim()).filter(Boolean).slice(0,60)`)

report.click = await evaluate(`(() => {
  const nodes = [...document.querySelectorAll('button, [role="button"], a')];
  const target = nodes.find((node) => /System/.test((node.getAttribute('title') ?? '') + ' ' + node.textContent));
  if (target === undefined) return { found: false };
  target.click();
  return { found: true, label: (target.getAttribute('title') ?? target.textContent).trim() };
})()`)
await sleep(5000)

report.page = await evaluate(`(() => {
  const page = document.querySelector('.sm-page');
  const body = document.body.innerText;
  if (page === null) return { rendered: false, note: body.slice(0, 600) };
  return {
    rendered: true,
    text: page.innerText.slice(0, 700),
    cards: [...page.querySelectorAll('.sm-card-title')].map(n=>n.textContent),
    notes: [...page.querySelectorAll('.sm-note')].map(n=>n.textContent),
    figures: [...page.querySelectorAll('.sm-figure')].map(n=>n.textContent),
    alerts: [...page.querySelectorAll('[role="alert"]')].map(n=>n.textContent),
  };
})()`)

report.directFetch = await evaluate(`(async () => {
  try {
    const r = await fetch('/dsh-system-monitor/snapshot', { credentials: 'same-origin' });
    const b = await r.json();
    return { status: r.status, keys: Object.keys(b.value ?? {}), hasStorage: b.value?.storage !== undefined };
  } catch (e) { return { error: String(e) }; }
})()`)

report.console = consoleLines.slice(-25)
report.pageErrors = pageErrors.slice(-10)
report.failed = [...new Set(failed)].slice(0, 25)
console.log(JSON.stringify(report, null, 2))

browser.close()
chrome.kill('SIGKILL')
rmSync(profile, { recursive: true, force: true })
