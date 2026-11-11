#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const root = await mkdtemp(join(tmpdir(), 'novel-api-registry-'))
const registryFile = join(root, 'registry.json')
process.env.NOVEL_DIRECTOR_API_REGISTRY = registryFile
const servers = []

async function endpoint(expectedKey, model) {
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    const requested = JSON.parse(body).model
    const valid = req.headers.authorization === 'Bearer ' + expectedKey && requested === model
    const status = { forbidden: 403, limited: 429 }[requested] ?? (valid ? 200 : 401)
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(valid ? { choices: [{ message: { content: model } }] } :
      { error: 'test rejected fixture-expired ' + req.headers.authorization }))
  })
  servers.push(server)
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
  return 'http://127.0.0.1:' + server.address().port
}

try {
  const compiled = await build({
    stdin: { resolveDir: repoRoot, contents: [
      "export * from './src/main/services/ApiRegistry'",
      "export * from './src/main/SecureCredentialService'",
      "export * from './src/main/services/AIService'",
      "export * from './src/main/services/MainAIJsonClient'",
      "export * from './src/services/ai/AIClient'"
    ].join('\n') },
    platform: 'node', format: 'esm', bundle: true, write: false,
    plugins: [{ name: 'test-credential-storage', setup(plugin) {
      plugin.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'fixture' }))
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
        contents: 'export const safeStorage={isEncryptionAvailable:()=>true, encryptString:s=>Buffer.from(s), decryptString:b=>b.toString()}'
      }))
    } }]
  })
  const { AIService, SecureCredentialService, MainAIJsonClient, AIClient, readApiRegistry, agentApiKey, backupKeyAfterRejection } =
    await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].contents).toString('base64'))
  const a = await endpoint('fixture-a', 'model-a'), b = await endpoint('fixture-b', 'model-b')
  const config = { version: 1, desktopSavedKeyFor: 'a', apis: {
    a: { baseUrl: a, aliases: [a + '/v1'], keyEnv: 'NOVEL_TEST_A_API_KEY' },
    b: { baseUrl: b + '/openai', keyEnv: 'NOVEL_TEST_B_API_KEY', backupKeyEnv: 'NOVEL_TEST_B_BACKUP_API_KEY' }
  } }
  await writeFile(registryFile, JSON.stringify(config))
  process.env.NOVEL_TEST_A_API_KEY = 'fixture-a'
  process.env.NOVEL_TEST_B_API_KEY = 'fixture-b'
  process.env.NOVEL_DIRECTOR_API_KEY = 'generic-fixture'
  const registry = await readApiRegistry()
  const desktop = new SecureCredentialService(root)
  await writeFile(desktop.getCredentialPath(), JSON.stringify({ apiKey: Buffer.from('old-desktop').toString('base64') }))
  const logs = []
  const options = { logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m) } }
  const request = (baseUrl, modelName) => ({
    settings: { apiProvider: 'compatible', baseUrl, modelName, temperature: 0.7, maxTokens: 256, retryEnabled: false,
      maxRetries: 0, requestTimeoutMs: 10000 }, messages: [{ role: 'user', content: 'test' }]
  })
  delete process.env.NOVEL_TEST_B_BACKUP_API_KEY
  const external = {
    getApiKey: async (url) => agentApiKey(registry, url, a),
    getBackupApiKey: async (url, rejected) => backupKeyAfterRejection(registry, url, rejected)
  }
  for (const reader of [desktop, external]) {
    const service = new AIService(reader, {}, options)
    const results = await Promise.all([service.chatCompletion(request(a + '/v1', 'model-a')),
      service.chatCompletion(request(b + '/openai', 'model-b'))])
    assert.deepEqual(results.map(r => r.content), ['model-a', 'model-b'])
  }
  delete process.env.NOVEL_TEST_A_API_KEY
  assert.equal(await desktop.getApiKey(a + '/v1/'), 'old-desktop')
  assert.equal(await external.getApiKey(a), '')
  assert.equal(await desktop.getApiKey(a + '/unlisted'), '')
  for (const reader of [desktop, external]) {
    const service = new AIService(reader, {}, options)
    const target = b + '/openai'
    const call = (model = 'model-b') => service.chatCompletion(request(target, model))
    process.env.NOVEL_TEST_B_API_KEY = 'fixture-b'
    process.env.NOVEL_TEST_B_BACKUP_API_KEY = 'fixture-unused'
    assert.equal((await call()).telemetry.attempts, 1)
    process.env.NOVEL_TEST_B_API_KEY = 'fixture-expired'
    process.env.NOVEL_TEST_B_BACKUP_API_KEY = 'fixture-b'
    const switched = await call()
    assert.equal(switched.content, 'model-b')
    assert.equal(switched.telemetry.attempts, 2)
    assert.equal(await reader.getBackupApiKey(a, 'fixture-expired'), '')
    for (const model of ['forbidden', 'limited']) {
      const denied = await call(model)
      assert.equal(denied.ok, false)
      assert.equal(denied.telemetry.attempts, 1)
    }
    delete process.env.NOVEL_TEST_B_API_KEY
    const onlyBackup = await call()
    assert.equal(onlyBackup.content, 'model-b')
    assert.equal(onlyBackup.telemetry.attempts, 1)
    process.env.NOVEL_TEST_B_API_KEY = 'fixture-expired'
    process.env.NOVEL_TEST_B_BACKUP_API_KEY = 'fixture-also-expired'
    const rejected = await call()
    assert.equal(rejected.ok, false)
    assert.equal(rejected.telemetry.attempts, 2)
    assert.ok(!rejected.error.includes('fixture-'))
  }
  delete process.env.NOVEL_TEST_B_BACKUP_API_KEY
  delete process.env.NOVEL_TEST_B_API_KEY
  await assert.rejects(desktop.getApiKey(b + '/openai'), /NOVEL_TEST_B_API_KEY/)
  const offlineSettings = { ...request(b + '/openai', 'model-b').settings, hasApiKey: false }
  const onlineService = new AIService(desktop, {}, options)
  for (const Client of [AIClient, MainAIJsonClient]) {
    const result = await new Client(offlineSettings, onlineService).requestJson('system', 'user', v => v, {})
    assert.equal(result.usedAI, true)
    assert.match(result.error, /NOVEL_TEST_B_API_KEY/)
  }
  assert.equal((await desktop.getState(a)).storedForEndpoint, true)
  await desktop.setApiKey('new-desktop', b + '/openai')
  await assert.rejects(desktop.getApiKey(a), /NOVEL_TEST_A_API_KEY/)
  assert.equal(await desktop.getApiKey(b + '/openai'), 'new-desktop')
  assert.equal(await external.getApiKey(b + '/other'), '')
  assert.ok(!logs.join(' ').includes('fixture-'))
  const state = await desktop.getState(b + '/openai')
  assert.ok(!JSON.stringify(state).includes('new-desktop'))
  await writeFile(registryFile, '{')
  await assert.rejects(desktop.getApiKey(a), /JSON/)
  config.apis.a.aliases = [b]
  await writeFile(registryFile, JSON.stringify(config))
  await assert.rejects(readApiRegistry(), /别名/)
  await rm(registryFile)
  assert.equal(await desktop.getApiKey(a), '')
  assert.equal(await desktop.getApiKey(b + '/openai'), 'new-desktop')
  assert.equal(agentApiKey(await readApiRegistry(), a, a), 'generic-fixture')
  assert.ok((await readFile(desktop.getCredentialPath(), 'utf8')).includes('baseUrl'))
  console.log('API registry: desktop and external routing, backup selection, aliases, missing keys, legacy binding, error and log checks passed.')
} finally {
  for (const server of servers) { server.closeAllConnections(); await new Promise((ok) => server.close(ok)) }
  if (dirname(resolve(root)) === resolve(tmpdir()) && basename(root).startsWith('novel-api-registry-')) {
    await rm(root, { recursive: true, force: true })
  }
}
