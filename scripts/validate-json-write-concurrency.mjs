#!/usr/bin/env node
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const [, , mode, modulePath, storagePath, operation] = process.argv
if (mode === 'worker') {
  const { JsonStorageService, previewCandidateDecisions } = await import(pathToFileURL(modulePath).href)
  const storage = new JsonStorageService(storagePath)
  const snapshot = await storage.loadSnapshot()
  const command = {
    id: 'decision-one', projectId: 'project-one', schemaVersion: 1, actor: { kind: 'user' },
    decidedAt: '2026-09-06T12:00:00.000Z', reason: 'Dismiss synthetic fixture',
    decisions: previewCandidateDecisions(snapshot.data, {
      projectId: 'project-one', decisions: [{ kind: 'memory', candidateId: 'candidate-one', decision: 'reject' }]
    }).items
  }
  process.send({ ready: true })
  process.once('message', async () => {
    try {
      if (operation === 'candidate') await storage.executeCandidateDecision(command, snapshot.revision)
      else await storage.saveIfCurrent({ ...snapshot.data,
        projects: snapshot.data.projects.map((project) => ({ ...project, name: operation })) }, snapshot.revision)
      process.send({ ok: true, operation })
    } catch (error) {
      process.send({ ok: false, operation, code: error.code, message: error.message })
    } finally {
      process.disconnect()
    }
  })
} else {
  const root = join(repoRoot, 'tmp', 'json-write-concurrency')
  await mkdir(root, { recursive: true })
  const bundlePath = join(root, 'storage.mjs')
  await build({ stdin: { contents: `export * from './src/storage/JsonStorageService';
    export * from './src/shared/defaults'; export * from './src/services/CandidateDecisionService';`, resolveDir: repoRoot },
    outfile: bundlePath, bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent' })
  const { JsonStorageService, normalizeAppData } = await import(pathToFileURL(bundlePath).href)
  const timestamp = '2026-09-06T00:00:00.000Z'
  const fixture = normalizeAppData({ projects: [{ id: 'project-one', name: 'Synthetic concurrency', createdAt: timestamp, updatedAt: timestamp }],
    memoryUpdateCandidates: [{ id: 'candidate-one', projectId: 'project-one', candidateType: 'chapter_review',
      proposedPatch: { kind: 'legacy_raw', rawText: 'Synthetic placeholder', summary: 'Fixture', warnings: [] },
      evidence: 'Synthetic evidence', confidence: 0.8, status: 'pending', createdAt: timestamp, updatedAt: timestamp }] })

  async function race(path, operations) {
    const workers = operations.map((operation) => {
      const child = fork(fileURLToPath(import.meta.url), ['worker', bundlePath, path, operation], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
      let result
      let stderr = ''
      child.stderr.on('data', (text) => { stderr += text })
      const ready = new Promise((resolve, reject) => {
        child.on('message', (message) => {
          if (message.ready) resolve()
          else result = message
        })
        child.once('error', reject)
        child.once('exit', (code) => { if (code !== 0) reject(new Error(stderr || `Worker exit ${code}`)) })
      })
      const done = new Promise((resolve, reject) => {
        child.once('error', reject)
        child.once('exit', (code) => code === 0 && result ? resolve(result) : reject(new Error(stderr || `Worker exit ${code}`)))
      })
      return { child, ready, done }
    })
    const timeout = setTimeout(() => workers.forEach(({ child }) => child.kill()), 15_000)
    try {
      await Promise.all(workers.map(({ ready }) => ready))
      workers.forEach(({ child }) => child.send('write'))
      return await Promise.all(workers.map(({ done }) => done))
    } finally {
      clearTimeout(timeout)
      for (const { child } of workers) if (child.exitCode === null) child.kill()
    }
  }

  let runs = 0
  for (const operations of [['writer-a', 'writer-b'], ['candidate', 'full-save']]) {
    for (let iteration = 0; iteration < 4; iteration++) {
      const path = join(root, `race-${runs++}.json`)
      const storage = new JsonStorageService(path)
      await storage.save(fixture)
      const results = await race(path, operations)
      assert.equal(results.filter((result) => result.ok).length, 1, JSON.stringify(results))
      assert.equal(results.find((result) => !result.ok).code, 'STORAGE_REVISION_CONFLICT')
      const data = await storage.load()
      const winner = results.find((result) => result.ok).operation
      assert.equal(data.candidateDecisionReceipts.length, winner === 'candidate' ? 1 : 0)
      assert.equal(data.memoryUpdateCandidates[0].status, winner === 'candidate' ? 'rejected' : 'pending')
      assert.equal(data.projects[0].name, winner === 'candidate' ? fixture.projects[0].name : winner)
      await assert.rejects(readFile(`${path}.write-lock`), { code: 'ENOENT' })
    }
  }
  // Two readers racing on an absent file must not reset a project written by the winner.
  const initialPath = join(root, 'initialize.json')
  await rm(initialPath, { force: true })
  const stores = [new JsonStorageService(initialPath), new JsonStorageService(initialPath)]
  await Promise.all(stores.map((storage) => storage.loadSnapshot()))
  await stores[0].save(fixture)
  assert.equal((await stores[1].load()).projects[0].id, 'project-one')
  console.log(`validate-json-write-concurrency: ok (${runs} real cross-process races + initialization)`)
}
