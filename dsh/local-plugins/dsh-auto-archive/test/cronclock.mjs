// Throwaway harness: proves the cron clock inside apply() fires on a minute
// boundary. Run from /home/personal/.dsh/profiles/web so cordis resolves.
import util from 'node:util'
const { Context } = await import('/home/personal/.local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis/lib/index.js')
const { TimerService } = await import('/home/personal/.local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis-plugin-timer/lib/index.js')
const plugin = await import('/home/personal/dsh-auto-archive/lib/index.js')

const ctx = new Context()
ctx.logger.exporter({ colors: 0, export: (m) => console.log('[LOG]', util.inspect(m.args, { depth: 2 }).slice(0, 200)) })

const archived = []
ctx.provide('workspaceRegistry', {
  archivedSessionIds: [],
  pinnedSessionIds: [],
  archiveSession: async (id) => {
    archived.push(id)
  },
})

const now = Date.now()
const old = now - 90 * 864e5
ctx.provide('sessionPersistence', {
  list: async () => [{ header: { id: 'idle', createdAt: old }, revision: `1:2:3:${BigInt(old) * 1_000_000n}:0` }],
})

await ctx.plugin(TimerService, {})
ctx.plugin(
  { name: plugin.name, inject: plugin.inject, Config: plugin.Config, apply: plugin.apply },
  // A zone is set on purpose: the matching loop must go through wallClock().
  { cron: '* * * * *', timeZone: 'Asia/Makassar', idleDays: 30, logPath: '/home/personal/dsh-auto-archive/.cronclock.log' },
)

console.log('waiting for a minute boundary…', new Date().toISOString())
setTimeout(() => {
  const status = ctx.get('autoArchive').status()
  console.log('lastRun:', status.lastRun && JSON.stringify({ reason: status.lastRun.reason, archived: status.lastRun.archived }))
  console.log('archived:', JSON.stringify(archived))
  process.exit(0)
}, 70_000)
