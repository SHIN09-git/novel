// Imported only by a disposable, extracted copy. Never install instrumentation in a measured binary.
import { app, ipcMain } from 'electron'
import { AsyncLocalStorage } from 'node:async_hooks'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
const DB = createRequire(import.meta.url)('better-sqlite3')
const scope = new AsyncLocalStorage()
const path = join(process.env.NOVEL_DIRECTOR_SMOKE_USER_DATA, 'probe.jsonl')
const log = obj => appendFileSync(path, JSON.stringify(obj) + '\n')
const bytes = value => Buffer.byteLength(JSON.stringify(value) ?? '')
const orig = DB.prototype.prepare
DB.prototype.prepare = function(sql) {
  const stmt = orig.call(this, sql)
  if (!/\bfrom\s+entities\b/i.test(sql)) return stmt
  const query = sql.trim().replace(/\s+/g, ' ')
  const whole = /^select (collection, (id, )?json|\*) from entities(?: order by .+)?$/i.test(query)
  for (const method of ['get', 'all', 'iterate']) {
    const original = stmt[method]
    stmt[method] = function(...args) {
      const counts = scope.getStore()?.queries
      if (counts) counts[query] = (counts[query] ?? 0) + 1
      if (whole) log({ whole: true, channel: scope.getStore()?.channel ?? 'outside-handler' })
      const result = original.apply(this, args)
      const ctx = scope.getStore()
      if (!ctx || !/^select\b/i.test(query)) return result
      const count = row => {
        if (!row) return
        if (typeof row.json !== 'string') { ctx.otherResultRows++; return }
        ctx.entityJsonRows++
        ctx.entityJsonBytes += Buffer.byteLength(row.json)
        const id = row.id ?? JSON.parse(row.json).id
        if (typeof id === 'string' && id.startsWith('two-')) ctx.secondBookJsonRows++
      }
      if (method === 'iterate') return (function* () {
        for (const row of result) { count(row); yield row }
      })()
      if (method === 'all') result.forEach(count)
      else count(result)
      return result
    }
  }
  return stmt
}
const register = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, callback) => register(channel, async (event, ...args) => {
  const ctx = { channel, queries: {}, entityJsonRows: 0, entityJsonBytes: 0, secondBookJsonRows: 0, otherResultRows: 0,
    requestJsonBytes: args.reduce((n,x) => n + bytes(x), 0) }
  const result = await scope.run(ctx, () => callback(event, ...args))
  log({ ...ctx, responseJsonBytes: bytes(result) })
  return result
})
log({ probe: 1, electron: process.versions.electron, packaged: app.isPackaged })
