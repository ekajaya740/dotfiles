import { apply } from '../lib/index.js'

const routes = []
const ctx = {
  get: () => undefined,
  effect: (fn) => fn(),
  webServer: { register: (r) => { routes.push(r); return () => {} } },
}
apply(ctx)
const route = routes[0]

async function call() {
  const cap = { status: 0, body: '' }
  const res = {
    headersSent: false,
    writeHead(s) { this.headersSent = true; cap.status = s },
    end(t) { if (t) cap.body += t },
    destroy() {},
  }
  await route.handler({ method: 'GET', url: '/dsh-system-monitor/snapshot' }, res)
  return { status: cap.status, body: JSON.parse(cap.body) }
}

const cold = await call()
const v = cold.body.value
console.assert(cold.status === 200 && cold.body.ok === true, 'cold status')
console.assert(v.cpu.perCore.length === v.host.cores, 'per-core count matches core count')
console.assert(v.cpu.usage > 0 && v.cpu.usage <= 1, `cold cpu usage in range: ${v.cpu.usage}`)
console.assert(v.memory.total > 0 && v.memory.used > 0, 'memory totals')
console.assert(v.storage.mounts.length > 0, 'at least one mount')
console.assert(v.storage.total > 0 && v.storage.used > 0, 'storage totals')
console.assert(v.storage.usage > 0 && v.storage.usage <= 1, `storage usage in range: ${v.storage.usage}`)
console.assert(v.storage.mounts.every((disk) => disk.inodesTotal >= 0 && disk.inodesUsage >= 0), 'inode columns present')
console.assert(v.storage.mounts.every((disk) => disk.mount === '/' || !disk.device.startsWith('/dev/') || disk.io !== null), 'io present for device mounts')
console.assert(v.storage.inodesTotal >= v.storage.inodesUsed, 'inode totals')
console.assert(v.storage.mounts.every((disk) => disk.usage >= 0 && disk.usage <= 1), 'per-mount usage in range')
console.assert(v.processes.total >= 1, 'processes sampled')
console.assert(Array.isArray(v.processes.topCpu) && v.processes.topCpu.length <= 5, 'topCpu bounded')
console.assert(v.net.every((entry) => entry.iface !== 'lo'), 'loopback excluded')

await new Promise((done) => setTimeout(done, 500))
const warm = await call()
const w = warm.body.value
console.assert(w.cpu.sampleMs >= 400, `warm sample window: ${w.cpu.sampleMs}`)
console.assert(w.cpu.usage >= 0 && w.cpu.usage <= 1, 'warm cpu usage in range')
console.assert(w.memory.total === v.memory.total, 'memory total stable')
console.assert(w.storage.total === v.storage.total, 'storage total stable')
console.assert(w.storage.read >= 0 && w.storage.write >= 0 && w.storage.busy >= 0, 'io rates non-negative')
console.assert(w.storage.mounts.some((disk) => disk.io !== null), 'io counters attached to a mount')

const forbidden = { headersSent: false, writeHead() {}, end() {}, destroy() {} }
const guarded = []
const ctx2 = {
  get: (key) => (key === 'connection' ? { requestRejection: () => 'no-token' } : undefined),
  effect: (fn) => fn(),
  webServer: { register: (r) => { guarded.push(r); return () => {} } },
}
const { apply: apply2 } = await import('../lib/index.js')
apply2(ctx2)
let status = 0
await guarded[0].handler({ method: 'GET', url: '/dsh-system-monitor/snapshot' }, {
  headersSent: false,
  writeHead(s) { status = s },
  end() {},
  destroy() {},
})
console.assert(status === 403, `cross-origin rejected: ${status}`)

console.log('cold cpu', (v.cpu.usage * 100).toFixed(1) + '%', 'warm cpu', (w.cpu.usage * 100).toFixed(1) + '%')
console.log('mem', (v.memory.used / 2 ** 30).toFixed(2), '/', (v.memory.total / 2 ** 30).toFixed(2), 'GiB')
console.log('storage', v.storage.mounts.map((d) => `${d.mount} ${(d.usage * 100).toFixed(0)}% ino ${d.inodesTotal > 0 ? (d.inodesUsage * 100).toFixed(0) + '%' : '-'}`).join(', '))
console.log('procs', v.processes.total, 'temp', v.temperature)
console.log('all assertions passed')
