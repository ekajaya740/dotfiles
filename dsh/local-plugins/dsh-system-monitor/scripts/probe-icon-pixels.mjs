// Raw-CDP probe: rasterize the sidebar icon and count painted pixels, so the
// check does not depend on an image-reading model.
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const require = createRequire('/home/personal/.dsh/profiles/web/package.json')
const WebSocket = require('ws')
const BASE = process.argv[2], TOKEN = process.argv[3], PORT = 9451
const profile = mkdtempSync(join(tmpdir(), 'sm-px-'))
const chrome = spawn('/home/personal/.agent-browser/browsers/chrome-155.0.8059.84/chrome', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] })
chrome.stderr.on('data', () => {})
const sleep = (ms) => new Promise((d) => setTimeout(d, ms))
async function url() { for (let i = 0; i < 160; i += 1) { try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) return (await r.json()).webSocketDebuggerUrl } catch {} await sleep(250) } throw new Error('no devtools') }
const browser = new WebSocket(await url())
await new Promise((d) => browser.once('open', d))
let id = 1; const pend = new Map()
const send = (m, p = {}, s) => { const n = id++; browser.send(JSON.stringify({ id: n, method: m, params: p, ...(s === undefined ? {} : { sessionId: s }) })); return new Promise((res, rej) => pend.set(n, { resolve: res, reject: rej })) }
browser.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.id === undefined) return; const s = pend.get(m.id); pend.delete(m.id); if (s === undefined) return; m.error === undefined ? s.resolve(m.result) : s.reject(new Error(JSON.stringify(m.error))) })
const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
const call = (m, p) => send(m, p, sessionId)
await call('Runtime.enable'); await call('Page.enable')
await call('Page.navigate', { url: `${BASE}/?token=${TOKEN}` })
await sleep(9000)
const ev = async (e) => { const r = await call('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value }
console.log(JSON.stringify(await ev(`(async () => {
  const span = document.querySelector('.sm-icon');
  if (span === null) return { found: false };
  const svg = span.querySelector('svg');
  const clone = svg.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', '64');
  clone.setAttribute('height', '64');
  clone.setAttribute('color', '#000');
  const markup = new XMLSerializer().serializeToString(clone);
  const image = new Image();
  const loaded = new Promise((done, fail) => { image.onload = done; image.onerror = fail });
  image.src = 'data:image/svg+xml;base64,' + btoa(markup);
  await loaded;
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 64;
  const g = canvas.getContext('2d');
  g.drawImage(image, 0, 0, 64, 64);
  const { data } = g.getImageData(0, 0, 64, 64);
  let painted = 0, solid = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 8) painted += 1;
    if (data[i] > 200) solid += 1;
  }
  // Column/row extents prove the glyph is centred, not clipped.
  let minX = 64, maxX = -1, minY = 64, maxY = -1;
  for (let y = 0; y < 64; y += 1) for (let x = 0; x < 64; x += 1) {
    if (data[(y * 64 + x) * 4 + 3] > 8) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  return { found: true, markupBytes: markup.length, paintedRatio: +(painted / 4096).toFixed(3), solidRatio: +(solid / 4096).toFixed(3), extent: { minX, maxX, minY, maxY }, centred: Math.abs((minX + maxX) / 2 - 31.5) <= 1.5 };
})()`), null, 2))
browser.close(); chrome.kill('SIGKILL'); rmSync(profile, { recursive: true, force: true })
