// Raw-CDP probe: the Storage card renders one cell per mount, with inode and
// throughput facts, and keeps refreshing. Run against a live server:
//   node scripts/probe-storage.mjs http://127.0.0.1:3111 <token> [width] [dark]
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire('/home/personal/.dsh/profiles/web/package.json')
const WebSocket = require('ws')
const BASE = process.argv[2]
const TOKEN = process.argv[3]
const PORT = 9347
const WIDTH = Number(process.argv[4] ?? 1440)
const DARK = process.argv[5] === 'dark'

const profile = mkdtempSync(join(tmpdir(), 'sm-storage-'))
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
// Open wide enough that the sidebar is expanded, then narrow down: at small
// widths the shell collapses the rail, so the entry would not be clickable.
await call('Emulation.setDeviceMetricsOverride', { width: Math.max(1440, WIDTH), height: 1000, deviceScaleFactor: 1, mobile: false })
if (DARK) await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
await call('Page.navigate', { url: `${BASE}/?token=${TOKEN}` })
await sleep(9000)

async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
  if (result.exceptionDetails !== undefined) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}

const clicked = await evaluate(`(() => {
  const nodes = [...document.querySelectorAll('button, [role="button"], a')];
  const target = nodes.find((node) => /System/.test((node.getAttribute('title') ?? '') + ' ' + node.textContent));
  if (target === undefined) return { found: false, candidates: nodes.map((node) => (node.getAttribute('title') ?? '') + '|' + node.textContent.slice(0, 20)).slice(0, 30) };
  target.click();
  return { found: true };
})()`)
await sleep(6000)
if (WIDTH < 1440) {
  await call('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 1000, deviceScaleFactor: 1, mobile: false })
  await sleep(2500)
}

const read = `(() => {
  const page = document.querySelector('.sm-page');
  if (page === null) return { found: false, reason: 'panel not open', body: document.body.innerText.slice(0, 200) };
  const card = [...page.querySelectorAll('.sm-card')].find((node) => node.querySelector('.sm-card-title')?.textContent === 'Storage');
  if (card === undefined) return { found: false };
  const cells = [...card.querySelectorAll('.sm-storage-cell')].map((cell) => ({
    mount: cell.querySelector('.sm-trunc')?.textContent,
    fs: cell.querySelector('.sm-note')?.textContent,
    facts: [...cell.querySelectorAll('.sm-storage-facts')].map((row) => [...row.children].map((node) => node.textContent)),
    bar: cell.querySelector('.sm-bar-fill')?.style.width,
    tone: cell.querySelector('.sm-bar-fill')?.getAttribute('data-tone'),
  }));
  const box = card.getBoundingClientRect();
  const pageBox = page.getBoundingClientRect();
  return {
    found: true,
    cells,
    totals: [...(card.querySelector('.sm-storage-totals')?.children ?? [])].map((node) => node.textContent),
    bad: [...card.querySelectorAll('*')].filter((node) => node.children.length === 0 && /NaN|undefined|null|Infinity|\\[object/.test(node.textContent ?? '')).map((node) => node.textContent.slice(0, 60)),
    overflow: [...card.querySelectorAll('*')].filter((node) => node.scrollWidth > node.clientWidth + 2 && node.clientWidth > 0).map((node) => node.className).slice(0, 6),
    box: { x: Math.round(box.x), w: Math.round(box.width), h: Math.round(box.height) },
    columns: getComputedStyle(card.parentElement).gridTemplateColumns,
    // The card carries gridColumn 1/-1, so it must match the grid's content
    // width exactly; pageBox is wider by the page padding.
    fullWidth: Math.abs(box.width - card.parentElement.getBoundingClientRect().width) < 2,
    insidePage: box.x >= pageBox.x && box.right <= pageBox.right,
    sparks: card.querySelectorAll('.sm-spark-line').length,
    colors: (() => {
      const cell = card.querySelector('.sm-storage-cell');
      const style = getComputedStyle(cell);
      return { border: style.borderTopColor, background: style.backgroundColor, text: getComputedStyle(card.querySelector('.sm-storage-facts')).color };
    })(),
  };
})()`

const first = await evaluate(read)
await sleep(4000)
const second = await evaluate(read)

const assertions = []
const check = (ok, label) => assertions.push({ ok, label })
if (first.found !== true) {
  // A failed open must not crash the probe: report what was on screen.
  console.log(JSON.stringify({ width: WIDTH, dark: DARK, clicked, first, assertions, errors }, null, 2))
  browser.close()
  chrome.kill('SIGKILL')
  rmSync(profile, { recursive: true, force: true })
  process.exit(1)
}
check(first.found === true, 'storage card present')
check(Array.isArray(first.cells) && first.cells.length > 0, `mount cells: ${first.cells?.length}`)
check(first.cells.every((cell) => typeof cell.mount === 'string' && cell.mount.startsWith('/')), 'every cell shows a mount path')
check(first.cells.every((cell) => typeof cell.fs === 'string' && cell.fs.length > 0), 'every cell shows a filesystem type')
check(first.cells.every((cell) => cell.facts.length === 2), 'every cell has space + inode/io fact rows')
check(first.cells.every((cell) => /inodes|inode/.test(cell.facts[1][0])), 'inode column rendered')
check(first.cells.every((cell) => /Read|读/.test(cell.facts[1][1])), 'throughput column rendered')
check(first.cells.every((cell) => /%$/.test(cell.bar) || cell.bar === ''), 'usage bar has a percentage width')
check(first.bad.length === 0, `no NaN/undefined text: ${first.bad?.join(' | ')}`)
check(first.overflow.length === 0, `no clipped text: ${first.overflow?.join(' | ')}`)
check(first.fullWidth === true, `card spans the grid width (${first.box?.w}px vs columns ${first.columns})`)
check(first.insidePage === true, 'card stays inside the page box')
check(first.totals.length === 3, `totals row: ${first.totals?.length} items`)
check(first.totals.some((text) => /inodes|inode/.test(text)), 'aggregate inode total')
check(first.totals.some((text) => /Busy|繁忙/.test(text)), 'aggregate busy share')
check(first.sparks >= 1, 'storage trend sparkline')
check(second.cells.length === first.cells.length, 'mount set stable between samples')
check(errors.length === 0, `no page errors: ${errors.join(' | ')}`)

console.log(JSON.stringify({ width: WIDTH, dark: DARK, clicked, first, second: { totals: second.totals, cells: second.cells.length }, assertions, failed: assertions.filter((entry) => entry.ok === false), errors }, null, 2))

browser.close()
chrome.kill('SIGKILL')
rmSync(profile, { recursive: true, force: true })
