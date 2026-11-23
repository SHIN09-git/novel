import assert from 'node:assert/strict'
import { mockAgentEndpoint } from '../utils/packaged-agent-journey.mjs'

const serviceId = 'journey-review'
const model = 'journey-review-mock'
const keyEnv = 'JOURNEY_REVIEW_API_KEY'
const token = 'only-for-this-loopback-fixture'
const step = 'consistency_review'
const isGate = request => request.messages.some(m => m.content.includes('You are a quality gate reviewer'))
const isConsistency = request => request.messages.some(m => m.content.includes('You are a continuity editor'))

export async function openReviewRecovery(respond, log) {
  const hits = []
  let injecting = false
  function handle(label, request, req) {
    const fail = label === 'primary' && injecting && isConsistency(request)
    const received = { label, url: `http://127.0.0.1:${req.socket.localPort}${req.url}`, model: request.model,
      phase: isGate(request) ? 'quality_gate' : isConsistency(request) ? step : 'other', status: fail ? 503 : 200 }
    if (label === 'alternate') {
      assert.equal(request.model, model)
      assert(injecting && (isGate(request) || isConsistency(request)), 'Only the recovering reviewer may use the alternate endpoint')
      assert(req.headers.authorization === 'Bearer ' + token, 'Missing synthetic route credential')
    }
    const result = fail ? Response.json({ error: { message: 'fixture-review-unavailable' } }, { status: 503 }) : respond(request)
    hits.push({ ...received, messages: request.messages })
    log('loopback-request', received)
    return result
  }
  const primary = await mockAgentEndpoint((r, req) => handle('primary', r, req))
  let alternate
  try { alternate = await mockAgentEndpoint((r, req) => handle('alternate', r, req)) }
  catch (error) { await primary.close(); throw error }
  return {
    baseUrl: primary.baseUrl, fixtureEnv: { [keyEnv]: token },
    registry: { [serviceId]: { baseUrl: alternate.baseUrl, protocol: 'openai-chat-completions', path: '/chat/completions', model, keyEnv } },
    allows: url => [primary, alternate].some(server => url === server.baseUrl + '/chat/completions'),
    arm() { injecting = true },
    async close() { try { await primary.close() } finally { await alternate.close() } },
    async recover({ failed, snapshot, call, body }) {
      assert.equal(failed.job.resumeFrom, step)
      assert.equal(failed.review.complete, false)
      assert.notEqual(failed.acceptance.state, 'available')
      assert.equal(failed.retryWithChannel.tool, 'agent.retryChapterPipeline')
      assert.equal(failed.retryWithChannel.arguments.expectedFailedStep, step)
      const failedHit = hits.at(-1)
      assert.equal(failedHit.url, primary.baseUrl + '/chat/completions')
      assert.equal(failedHit.status, 503)
      assert(failedHit.messages.some(m => m.content.includes(body.trim())))
      assert.equal((await call('getDraftText', failed.draft.read.arguments)).data.text, body)
      const before = (await snapshot()).data
      const steps = data => data.chapterGenerationSteps.filter(s => s.jobId === failed.job.id)
      assert(steps(before).some(s => s.type === step && s.status === 'failed'))
      const saved = steps(before).filter(s => ['completed', 'skipped'].includes(s.status))
      assert(saved.some(s => s.type === 'generate_chapter_draft' && s.status === 'completed'))
      assert(saved.some(s => s.type === 'generate_chapter_review' && s.status === 'completed'))
      assert.equal(before.chapterCommitBundles.length, 3)
      const start = hits.length
      const { channels } = (await call('listAvailableChannels')).data
      assert(channels.some(c => c.registryServiceId === serviceId && c.model === model))
      const result = await call('retryChapterPipeline', { ...failed.retryWithChannel.arguments, registryServiceId: serviceId })
      const item = result.data.workItem
      assert.equal(item.draft.id, failed.draft.id)
      assert.equal(item.draft.draftContentHash, failed.draft.draftContentHash)
      assert.equal(item.review.complete, true)
      assert.equal(item.acceptance.mode, 'reviewed')
      const after = (await snapshot()).data
      assert.deepEqual(after.generatedChapterDrafts, before.generatedChapterDrafts)
      assert.deepEqual(after.settings, before.settings)
      const roles = data => data.chapterGenerationJobs.find(job => job.id === failed.job.id).aiRunConfig.roles
      const { reviewer: oldReviewer, ...otherBefore } = roles(before)
      const { reviewer: newReviewer, ...otherAfter } = roles(after)
      assert.deepEqual(otherAfter, otherBefore)
      assert.equal(oldReviewer.baseUrl, primary.baseUrl)
      assert.equal(newReviewer.baseUrl, alternate.baseUrl)
      assert.equal(newReviewer.modelName, model)
      assert.deepEqual(after.chapterCommitBundles, before.chapterCommitBundles)
      assert.deepEqual(steps(after).filter(s => saved.some(prev => prev.id === s.id)), saved)
      assert.deepEqual(hits.slice(start).map(h => [h.label, h.phase]), [['alternate', step], ['alternate', 'quality_gate']])
      const retry = hits[start]
      assert.equal(retry.url, alternate.baseUrl + '/chat/completions')
      assert.deepEqual(retry.messages, failedHit.messages)
      injecting = false
      log('review-recovered', { chapter: 4, step, serviceId, from: failedHit.url, to: retry.url,
        draftId: item.draft.id, bodyHash: item.draft.draftContentHash, unchangedSteps: saved.map(s => s.type) })
      return result
    },
    verify() {
      assert.equal(hits.filter(h => h.status === 503).length, 1)
      assert.equal(hits.filter(h => h.label === 'alternate').length, 2)
    }
  }
}
