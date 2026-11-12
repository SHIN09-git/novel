// Export only numeric samples, build identities and synthetic sentinels; never ship profiles.
import assert from 'node:assert/strict'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const [name, times, diagnostics] = process.argv.slice(2)
assert(['before','after'].includes(name))
const dir = dirname(fileURLToPath(import.meta.url)), root = resolve(dir,'../..')
async function load(path,mode) {
  assert(new RegExp('^s3-' + name + '-' + mode + '-[A-Za-z0-9]+$').test(path))
  const target = join(root,'tmp',path,'report.json')
  assert.equal(await realpath(target),target)
  const report = JSON.parse(await readFile(target,'utf8'))
  assert(report.passed && report.side === name && report.mode === mode)
  for (const s of report.samples) {
    assert(s.passed && s.remainingProcesses === 0 && (s.due || s.recentBackupUnchanged))
    assert(s.readback.commitsVerified)
    assert.deepEqual(s.readback.books,report.seedChecks.books)
  }
  return report
}
const t = await load(times,'timing'), d = await load(diagnostics,'diagnostic')
assert.deepEqual(t.identity,d.identity)
assert.deepEqual(t.fixture,d.fixture)
const actions = ['startup','open','accept','revision']
const result = { schema: 1, side:name, identity:t.identity, host:t.host,
  app:t.samples[0].runtime, fixture:t.fixture, readback:t.seedChecks.books,
  timedWindow:t.samples.map(s => ({due:s.due, phase:s.phase, index:s.index, ms:s.ms,
    automaticBytes:s.backupBytes, rollbackBytes:s.rollbackBytes, remainingProcesses:s.remainingProcesses,
    recentBackupUnchanged:s.recentBackupUnchanged, persisted:s.readback.commitsVerified})), summaries:{}, diagnostic:{} }
for (const due of [false,true]) {
  const group = due ? 'due' : 'recent'
  const samples = t.samples.filter(s => s.due === due && s.phase === 'measured')
  assert.equal(samples.length,5)
  assert.equal(t.samples.filter(s => s.due === due && s.phase === 'warmup').length,1)
  const reads = d.samples.filter(s => s.due === due)
  assert.equal(reads.length,1)
  const [s] = reads
  result.summaries[group] = {}
  result.diagnostic[group] = {}
  for (const a of actions) {
    const sorted = samples.map(s=>s.ms[a]).sort((a,b)=>a-b)
    result.summaries[group][a] = {n:5, medianMs:sorted[2], maxMs:sorted[4]}
    const o = s.observations[a]
    const ipc = o.events.filter(e=>Object.hasOwn(e,'responseJsonBytes'))
    assert(ipc.length)
    const sql = Object.assign({},...ipc.map(e=>e.queries))
    const sum = key => ipc.reduce((n,e)=>n+e[key],0)
    result.diagnostic[group][a] = {fullReads:o.fullReads,requestJsonBytes:o.requestJsonBytes,responseJsonBytes:o.responseJsonBytes,
      entityRows:sum('entityJsonRows'), entityJsonBytes:sum('entityJsonBytes'), secondBookRows:sum('secondBookJsonRows'),
      otherResultRows:sum('otherResultRows'), changed:o.changed, ipc:ipc.map(e=>e.channel), sql}
    assert(Number.isFinite(result.diagnostic[group][a].entityRows))
  }
}
if (name === 'after') {
  const before = JSON.parse(await readFile(join(dir,'s3-before.json'),'utf8'))
  for (const key of ['packagedDependencies','sqliteBinding','canonicalS1','canonicalCurrent']) assert.equal(before.identity[key],result.identity[key],key)
  assert.deepEqual(before.host,result.host)
  assert.equal(before.app.electron,result.app.electron)
  assert.deepEqual(before.fixture,result.fixture)
}
const output = join(dir,'s3-' + name + '.json')
await writeFile(output,JSON.stringify(result,null,2) + '\n')
console.log(basename(output),JSON.stringify(result.summaries))
