// Host-side IO check: sustained writes must show up in the storage rates.
// Kept in the suite because the counter deltas are easy to break silently —
// a wrong device key or a reset baseline reports 0 B/s under real load.
import { writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { apply } from '../lib/index.js'

const routes = []
const ctx = {
  get: () => undefined,
  effect: (fn) => fn(),
  webServer: { register: (route) => { routes.push(route); return () => {} } },
}
apply(ctx)

async function snapshot() {
  const captured = { status: 0, body: '' }
  await routes[0].handler({ method: 'GET', url: '/dsh-system-monitor/snapshot' }, {
    headersSent: false,
    writeHead(status) { this.headersSent = true; captured.status = status },
    end(text) { if (text) captured.body += text },
    destroy() {},
  })
  return JSON.parse(captured.body).value
}

// Warm sample: establishes the baseline the next read compares against.
const cold = await snapshot()
console.assert(cold.storage.mounts.length > 0, 'mounts present')

const scratch = '/home/personal/dsh-system-monitor/test/.io-scratch'
rmSync(scratch, { recursive: true, force: true })
mkdirSync(scratch, { recursive: true })
const payload = Buffer.alloc(96 * 1024 * 1024, 3)
const startedAt = Date.now()
for (let index = 0; index < 3; index += 1) writeFileSync(join(scratch, `chunk-${index}.bin`), payload)
const seconds = (Date.now() - startedAt) / 1000

const warm = await snapshot()
rmSync(scratch, { recursive: true, force: true })

const rootMount = warm.storage.mounts.find((mount) => mount.mount === '/') ?? warm.storage.mounts[0]
console.assert(warm.storage.write > 0, `aggregate write rate above zero: ${warm.storage.write}`)
console.assert(warm.storage.read >= 0, 'read rate non-negative')
console.assert(warm.storage.busy >= 0 && warm.storage.busy <= 1, `busy share in range: ${warm.storage.busy}`)
console.assert(rootMount.io !== null, 'root mount carries io counters')
console.assert(rootMount.io.write > 0, `root mount write rate above zero: ${rootMount.io.write}`)
console.assert(rootMount.io.writeTotal > 0, 'cumulative write bytes reported')
console.assert(warm.storage.write <= 4096 * 1024 * 1024, `write rate plausible: ${(warm.storage.write / 2 ** 20).toFixed(0)} MiB/s`)

console.log('wrote', (payload.length * 3 / 2 ** 20).toFixed(0), 'MiB in', seconds.toFixed(2), 's')
console.log('reported write', (warm.storage.write / 2 ** 20).toFixed(1), 'MiB/s', 'busy', (warm.storage.busy * 100).toFixed(1) + '%')
console.log('all io assertions passed')
