// Raw-CDP probe: layout + content assertions for the System monitor panel.
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire('/home/personal/.dsh/profiles/web/package.json')
const WebSocket = require('ws')
const BASE = process.argv[2]
const TOKEN = process.argv[3]
const PORT = 9343

const profile = mkdtempSync(join(tmpdir(), 'sm-layout-'))
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
await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
await call('Page.navigate', { url: `${BASE}/?token=${TOKEN}` })
await sleep(9000)

async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
  if (result.exceptionDetails !== undefined) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}

await evaluate(`(() => {
  const nodes = [...document.querySelectorAll('button, [role="button"], a')];
  (nodes.find((node) => /System/.test((node.getAttribute('title') ?? '') + ' ' + node.textContent)))?.click();
})()`)
await sleep(6000)

const first = await evaluate(`(() => {
  const page = document.querySelector('.sm-page');
  const rect = page.getBoundingClientRect();
  const cards = [...page.querySelectorAll('.sm-card')].map((card) => {
    const box = card.getBoundingClientRect();
    return { title: card.querySelector('.sm-card-title')?.textContent, x: Math.round(box.x), w: Math.round(box.width), h: Math.round(box.height) };
  });
  const bars = [...page.querySelectorAll('.sm-bar-fill')].map((bar) => bar.style.width);
  const bad = [...page.querySelectorAll('*')].filter((node) => /NaN|undefined|null|Infinity|\\[object/.test(node.textContent ?? '') && node.children.length === 0).map((node) => node.textContent.slice(0, 60));
  const tables = [...page.querySelectorAll('.sm-table')].map((table) => ({ head: [...table.querySelectorAll('th')].map((th) => th.textContent), rows: [...table.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent)) }));
  const overflow = [...page.querySelectorAll('*')].filter((node) => node.scrollWidth > node.clientWidth + 2 && node.clientWidth > 0).map((node) => node.className).slice(0, 10);
  return {
    pageBox: { x: Math.round(rect.x), w: Math.round(rect.width), h: Math.round(rect.height) },
    docOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    cards, bars, bad, tables, overflow,
    cores: [...page.querySelectorAll('.sm-core-label')].map((node) => node.textContent),
    memoryRows: [...page.querySelectorAll('.sm-row')].map((row) => [...row.children].map((cell) => cell.textContent || cell.style.width)),
  };
})()`)

// Pause must freeze the figures; a resumed monitor must move them again.
const pauseTest = await evaluate(`(async () => {
  const page = document.querySelector('.sm-page');
  const button = [...page.querySelectorAll('.sm-btn')].find((node) => /Pause|暂停/.test(node.textContent));
  button.click();
  const before = [...page.querySelectorAll('.sm-figure')].map((node) => node.textContent);
  const sparks = () => page.querySelectorAll('.sm-spark-line')[0].getAttribute('d');
  const sparkBefore = sparks();
  await new Promise((done) => setTimeout(done, 5000));
  return { button: button.textContent, before, after: [...page.querySelectorAll('.sm-figure')].map((node) => node.textContent), sparkFrozen: sparkBefore === sparks() };
})()`)

console.log(JSON.stringify({ first, pauseTest, errors }, null, 2))
browser.close()
chrome.kill('SIGKILL')
rmSync(profile, { recursive: true, force: true })
