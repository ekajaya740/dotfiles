// Raw-CDP probe: the sidebar icon in both colour schemes.
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const require = createRequire('/home/personal/.dsh/profiles/web/package.json')
const WebSocket = require('ws')
const BASE = process.argv[2], TOKEN = process.argv[3], PORT = 9453
const profile = mkdtempSync(join(tmpdir(), 'sm-theme-'))
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
const READ = `(() => {
  const span = document.querySelector('.sm-icon');
  if (span === null) return { found: false };
  const stroke = getComputedStyle(span.querySelector('svg path')).stroke;
  // Walk up for the first opaque background: the row itself is transparent.
  let node = span, bg = 'rgba(0, 0, 0, 0)';
  while (node !== null) {
    const value = getComputedStyle(node).backgroundColor;
    if (value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') { bg = value; break }
    node = node.parentElement;
  }
  const parse = (value) => (value.match(/\\d+(\\.\\d+)?/g) ?? []).slice(0, 3).map(Number);
  const lum = (rgb) => { const [r, g, b] = rgb.map((c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b };
  const a = lum(parse(stroke)), b = lum(parse(bg));
  return { stroke, bg, contrast: +(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05))).toFixed(2) };
})()`
const light = await ev(READ)
await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
await sleep(1500)
const dark = await ev(READ)
console.log(JSON.stringify({ light, dark }, null, 2))
browser.close(); chrome.kill('SIGKILL'); rmSync(profile, { recursive: true, force: true })
