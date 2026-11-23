// Private fixture for validate-agent-pipeline-execution.mjs.
import assert from 'node:assert/strict'
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { mock } from 'node:test'

const route = 'fixture-route'
const baseUrl = 'https://channel-retry.invalid/fixture/v1'
const model = 'fixture-review-model'
const keyEnv = 'FIXTURE_ROUTE_API_KEY'
const token = 'synthetic-channel-retry-token'
const step = 'quality_gate'

export async function isolatePipelineRegistry(outDir) {
  // The validator owns this Node process. Never read or restore inherited key values.
  for (const name of Object.keys(process.env)) if (/_API_KEY$/i.test(name)) delete process.env[name]
  const home = join(outDir, 'profile')
  Object.assign(process.env, { HOME: home, USERPROFILE: home, APPDATA: home, XDG_CONFIG_HOME: home,
    CODEX_HOME: join(home, '.codex'), NOVEL_DIRECTOR_API_REGISTRY: join(outDir, 'api-registry.json') })
  const profile = process.platform === 'darwin' ? join(home, 'Library', 'Application Support', 'Novel Director') : join(home, 'Novel Director')
  await mkdir(profile, { recursive: true })
  await writeFile(process.env.NOVEL_DIRECTOR_API_REGISTRY, JSON.stringify({ version: 1, apis: {
    [route]: { protocol: 'openai-chat-completions', path: '/chat/completions', baseUrl, model, keyEnv }
  } }))
  return profile
}

async function verifyListing(h, profile) {
  // Listing takes no storage arguments. Normal runtime loading would fail on this default library.
  const filename = 'novel-director-data.json', marker = 'deliberately invalid JSON'
  await writeFile(join(profile, filename), marker)
  const result = await h.AgentToolService.callTool({ name: 'agent.listAvailableChannels', arguments: {} })
  assert.deepEqual(result.data.channels.map(c => c.registryServiceId).sort(), ['codex_cli', route])
  const descriptors = h.AgentToolService.listTools()
  assert.ok(descriptors.some(t => t.name === 'agent.listAvailableChannels'))
  const retrySchema = descriptors.find(t => t.name === 'agent.retryChapterPipeline').inputSchema.properties
  assert.ok(retrySchema.registryServiceId && retrySchema.expectedFailedStep)
  const listing = JSON.stringify([result, descriptors.filter(t => t.name === 'agent.listAvailableChannels')])
  for (const hidden of [token, keyEnv, 'channel-retry.invalid', 'baseUrl', 'backupKeyEnv']) {
    assert.ok(!listing.includes(hidden), 'Channel discovery exposed private registry configuration')
  }
  assert.deepEqual(await readdir(profile), [filename])
  assert.equal(await readFile(join(profile, filename), 'utf8'), marker)
}

export async function verifyChannelRetry(h, { outDir, isolatedProfile, switchPath, agentRunId, jobId, report }) {
  const ids = { agentRunId, jobId }
  const requests = []
  const { overallScore, pass, dimensions, issues, requiredFixes, optionalSuggestions } = report
  const content = JSON.stringify({ overallScore, pass, dimensions, issues, requiredFixes, optionalSuggestions })
  // Mock only the final transport boundaries: exercise normal routing, credential selection,
  // review prompts and parsing without opening a socket or spawning a logged-in CLI.
  const http = mock.method(globalThis, 'fetch', async (url, init) => {
    const payload = JSON.parse(init.body)
    requests.push({ provider: 'http', url: String(url), method: init.method, model: payload.model, messages: payload.messages,
      authenticated: new Headers(init.headers).get('authorization') === 'Bearer ' + token })
    return Response.json({ model: payload.model, choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] })
  })
  const cli = mock.method(h.CodexCliService.prototype, 'chatCompletion', async request => {
    requests.push({ provider: 'codex_cli', model: request.model, messages: request.messages })
    request.onDispatch?.()
    return { ok: true, content }
  })
  try {
    process.env[keyEnv] = token
    await verifyListing(h, isolatedProfile)
    assert.equal(requests.length, 0, 'Listing channels dispatched a model request')
    for (const entry of ['mcp', 'executor']) {
      const storagePath = join(outDir, 'channel-retry-' + entry + '.json')
      await copyFile(switchPath, storagePath)
      const paths = { storagePath, userDataPath: outDir }
      const load = () => h.loadAgentRuntimeData(paths)
      const retry = async args => entry === 'mcp'
        ? (await h.AgentToolService.callTool({ name: 'agent.retryChapterPipeline', arguments: { ...paths, ...ids, ...args } })).data
        : h.executeAgentChapterPipeline({ runtime: await load(), ...ids, ...args })
      const channel = entry === 'mcp' ? route : 'codex_cli'
      const switchTo = { registryServiceId: channel, expectedFailedStep: step }
      const checkpoint = await readFile(storagePath)
      const before = (await load()).data
      const job = data => data.chapterGenerationJobs.find(j => j.id === jobId)
      const run = data => data.agentRuns.find(r => r.id === agentRunId)
      const earlierSteps = data => data.chapterGenerationSteps.filter(s => s.jobId === jobId &&
        h.AGENT_PIPELINE_STEP_ORDER.indexOf(s.type) < h.AGENT_PIPELINE_STEP_ORDER.indexOf(step))
      const draft = before.generatedChapterDrafts.find(d => d.jobId === jobId)
      assert.ok(draft?.body && job(before).currentStep === step)
      assert.ok(before.chapterGenerationSteps.some(s => s.jobId === jobId && s.type === step && s.status === 'failed'))
      async function rejectUnchanged(args, label) {
        const bytes = await readFile(storagePath), count = requests.length
        await assert.rejects(() => retry(args), entry + ': ' + label)
        assert.equal(requests.length, count, label + ' dispatched a provider call')
        assert.ok(bytes.equals(await readFile(storagePath)), label + ' changed the library')
      }
      for (const [label, args] of [
        ['unknown service', { ...switchTo, registryServiceId: 'absent-route' }],
        ['different failed step (same role)', { ...switchTo, expectedFailedStep: 'consistency_review' }],
        ['missing service ID', { expectedFailedStep: step }],
        ['missing expected step', { registryServiceId: route }],
        ['ambiguous config source', { ...switchTo, refreshModelConfigFromSettings: true }]
      ]) await rejectUnchanged(args, label)
      delete process.env[keyEnv]
      await rejectUnchanged({ ...switchTo, registryServiceId: route }, 'missing HTTP credential')

      // Matching a step name alone is not sufficient: it must be failed AND model-backed.
      for (const [type, status] of [[step, 'pending'], ['await_user_confirmation', 'failed']]) {
        const edited = JSON.parse(checkpoint)
        const steps = edited.chapterGenerationSteps.filter(s => s.jobId === jobId)
        steps.find(s => s.type === step).status = type === step ? status : 'completed'
        steps.find(s => s.type === type).status = status
        job(edited).currentStep = type
        await writeFile(storagePath, JSON.stringify(edited))
        await rejectUnchanged({ registryServiceId: 'codex_cli', expectedFailedStep: type }, type + '/' + status)
      }
      await writeFile(storagePath, checkpoint)
      if (channel === route) process.env[keyEnv] = token
      const start = requests.length
      const result = await retry(switchTo)
      assert.equal(result.failedStep, null)
      assert.equal(entry === 'mcp' ? result.resumedFromStep : result.startedFromStep, step)
      assert.deepEqual(result.draftIds, [draft.id])
      const after = (await load()).data
      assert.deepEqual(after.settings, before.settings)
      assert.deepEqual(after.chapters, before.chapters)
      assert.deepEqual(after.generatedChapterDrafts, before.generatedChapterDrafts)
      assert.deepEqual(earlierSteps(after), earlierSteps(before))
      const { roles: oldRoles, ...oldConfig } = job(before).aiRunConfig
      const { roles: newRoles, ...newConfig } = job(after).aiRunConfig
      const { reviewer: oldReviewer, ...otherBefore } = oldRoles
      const { reviewer, ...otherAfter } = newRoles
      assert.deepEqual(newConfig, oldConfig)
      assert.deepEqual(otherAfter, otherBefore)
      assert.notDeepEqual(reviewer, oldReviewer)
      const calls = requests.slice(start)
      assert.equal(calls.length, 1, 'Only the failed review should contact a provider')
      const [call] = calls
      assert.ok(call.messages.some(m => m.content.includes(draft.body)), 'Review request must contain the saved prose')
      if (channel === route) {
        assert.equal(reviewer.apiProvider, 'compatible')
        assert.equal(reviewer.baseUrl, baseUrl)
        assert.equal(reviewer.modelName, model)
        assert.equal(call.provider, 'http')
        assert.equal(call.method, 'POST')
        assert.equal(call.url, baseUrl + '/chat/completions')
        assert.equal(call.model, model)
        assert.ok(call.authenticated, 'HTTP retry did not use the registry route credential')
      } else {
        assert.equal(reviewer.apiProvider, 'codex_cli')
        assert.equal(call.provider, 'codex_cli')
        assert.equal(call.model, reviewer.codexCliModel || '')
      }
      const applied = run(after).decisions.filter(d => !run(before).decisions.some(prev => prev.id === d.id) &&
        d.jobId === jobId && d.step === step && d.action === 'retry_step' && d.result === 'applied')
      assert.equal(applied.length, 1)
      const evidence = applied[0].evidence.join('\n')
      for (const label of ['reviewer', channel, oldReviewer.modelName, ...(channel === route ? [model] : [])]) {
        assert.ok(evidence.includes(label), 'Missing persisted channel-switch evidence: ' + label)
      }
      assert.ok(!JSON.stringify(after).includes(token), 'Registry credential persisted in the book')
      assert.ok(after.qualityGateReports.some(r => r.jobId === jobId && r.draftId === draft.id &&
        r.draftContentHash === h.draftContentHash(draft.body)))
      await rejectUnchanged(switchTo, 'already reviewed job')
      process.env[keyEnv] = token
    }
    console.log('PASS registry channel discovery and scoped retry (MCP HTTP, executor Codex CLI).')
  } finally {
    delete process.env[keyEnv]
    http.mock.restore()
    cli.mock.restore()
  }
}
