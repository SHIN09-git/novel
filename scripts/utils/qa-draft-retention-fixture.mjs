import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'

export const hash = (text) => createHash('sha256').update(text, 'utf8').digest('hex')
export const visible = (text) => [...text.replace(/\s/gu, '')].length
const title = '寄存窗'
const prose = [
  '雨停在五点一刻。林禾把一只旧木箱搬上寄存处的柜台，先垫好一张报纸，再把搭扣翻开。柜员伸过手来要看票，她把口袋翻给他看，里面只有一枚顶针。顶针压出的一圈红印还在掌心，票却不知落在哪一站了。',
  '柜员拿尺子量了箱子的长宽，把数字一笔一画填进登记簿。轮到填颜色，他停下来看她。漆已经脱尽了，四个角被人摸得发亮，只有提手底下剩一点蓝。林禾把提手抬起来。柜员低下头去，终于在那格挤进一个很小的蓝字。',
  '屋檐上的水顺着铁链滴进搪瓷盆。有人来取一卷凉席，也有人扛着缝纫机进门，手腕上勒了一道白痕。林禾往旁边挪了半步，替那人抵住门。等她转过身，柜员已经在木箱边放好两只杯子，其中一只杯沿缺了口。',
  '她没有喝茶。箱子是父亲留下的，最后一次合上盖子的也是他。她只记得里面有一卷麻线，麻线下面压着一本车票册。柜员听她说完，把登记簿转了半圈，指给她看前一页的字。那行字跟她刚写的一模一样，连寄存二字之间留的小空当都一样。',
  '林禾借来铅笔，在报纸空白处又写了一遍。小时候父亲教她写寄字，总要把上面一点单独描深。纸薄，铅笔的尖把那一点戳出了一个窟窿。她把纸举到窗前，远处月台的灯就在窟窿里亮着，列车经过时短短地暗了一下。',
  '柜员从柜台下面抽出绳子，说钥匙可以暂存在这里，明天再回来领。他把绳子打了个松结，两根绳头留得很长。林禾没有把钥匙交给他。她拎起木箱试了试重量，又放回原处，轻得像是底板上只躺着那卷线。',
  '她解开松结，拨开搭扣。麻线和票册都还在，另有一块方手绢，洗得已经看不出原来的颜色。手绢裹着一粒小纽扣。有人用红线在纽扣眼里绕了两圈，末端埋进布角，不拆开便看不出它是后来才缝上去的。',
  '登记簿翻到最后，夹页里露出另外半张报纸。柜员把两张报纸沿着撕开的边一拼，正好合成一则寻物启事。启事上没有姓名，只有车次和座号。林禾慢慢用指腹按平裂口，感觉到背面有一道早已干透的胶水。',
  '她把启事翻过来。背面是一幅铅笔画成的小地图，只画了站前的邮筒和一排旧信箱。最末一格有个细细的叉。柜员从抽屉最深处拿出一把铜钥匙，放在地图的叉上。她认得钥匙上的缺口，以前那是挂在父亲腰带上的。',
  '远处传来末班车进站的铃声。柜员把窗扇慢慢推回去，只留能递出一封信的宽度。林禾把地图放回手绢，摸到纽扣上那两圈红线。她张开手，又重新合住。隔着柜台，柜员也停下了手里的铅笔。',
  '他停在开口前'
].join('\n\n')

export const cases = [
  { id: 'overflow-retry', end: '。', finish: 'stop', overflow: true },
  { id: 'length-fragment', end: '。', finish: 'length', negative: 'fragment' },
  { id: 'ellipsis-stop', end: '……', finish: 'stop' },
  { id: 'pause-no-signal', end: '' },
  { id: 'dash-stop', end: '——', finish: 'stop' },
  { id: 'broken-stop', end: '。', finish: 'stop', negative: 'broken' },
  { id: 'empty-no-signal', end: '', negative: 'empty' }
].map(spec => ({
  ...spec, title, body: prose + spec.end, projectId: 'qa-retention-' + spec.id,
  name: '寄存窗 / ' + spec.id, target: spec.overflow ? '600-800' : '600-1600'
}))

const fillFields = (names, value) => Object.fromEntries(names.split(' ').map(name => [name, value]))
const extraction = {
  chapterReview: { ...fillFields('newInformation characterChanges newForeshadowing resolvedForeshadowing endingHook riskWarnings', ''),
    summary: '林禾在登记簿中看见旧笔迹。', characterStateChangeSuggestions: [],
    continuityBridgeSuggestion: fillFields('lastSceneLocation lastPhysicalState lastEmotionalState lastUnresolvedAction lastDialogueOrThought immediateNextBeat mustContinueFrom mustNotReset openMicroTensions', '') },
  characterSuggestions: [], foreshadowingExtraction: fillFields('newForeshadowingCandidates advancedForeshadowingIds resolvedForeshadowingIds abandonedForeshadowingCandidates statusChanges', [])
}
const consistency = { ...fillFields('timelineProblems settingConflicts characterOOC foreshadowingMisuse pacingProblems emotionPayoffProblems suggestions issues', []), severitySummary: 'low' }
const quality = { overallScore: 91, pass: true, issues: [], requiredFixes: [], optionalSuggestions: [],
  dimensions: fillFields('plotCoherence characterConsistency characterStateConsistency foreshadowingControl chapterContinuity redundancyControl styleMatch pacing emotionalPayoff originality promptCompliance contextRelevanceCompliance', 91) }

export const roles = ['planner', 'prose', 'extraction', 'reviewer', 'revision']
export function fixture(spec, baseUrl) {
  const at = '2026-01-02T03:04:05.000Z'
  assert.match(baseUrl, /^http:\/\/127\.0\.0\.1:\d+\/v1$/)
  const model = { apiProvider: 'local', baseUrl, modelName: 'retention-unused', temperature: 0, maxTokens: 4096,
    retryEnabled: false, maxRetries: 0, requestTimeoutMs: 30000, codexCliPath: '', codexCliModel: '' }
  return { schemaVersion: 3, projects: [{ id: spec.projectId, name: spec.name, genre: '小说', description: '',
    targetReaders: '', coreAppeal: '', style: '', createdAt: at, updatedAt: at }], chapters: [],
    settings: { ...model, apiKey: '', hasApiKey: false, enableAutoSummary: false, enableChapterDiagnostics: false,
      pipelineModelRoles: Object.fromEntries(roles.map(role => [role, { ...model, modelName: 'retention-' + role }])) } }
}

// Count physical HTTP requests, not logical pipeline steps. Never proxy or look up credentials.
export async function startStub(spec) {
  const calls = []
  let releaseFailure
  const failureBarrier = new Promise(resolve => { releaseFailure = resolve })
  const server = createServer(async (req, res) => {
    const call = { n: calls.length + 1, at: new Date().toISOString(), method: req.method, path: req.url }
    calls.push(call)
    const reply = (status, payload) => {
      call.status = status
      res.writeHead(status, { 'Content-Type': 'application/json', Connection: 'close' })
      res.end(JSON.stringify(payload))
    }
    try {
      assert.equal(req.socket.remoteAddress, '127.0.0.1')
      assert.equal(req.headers.host, '127.0.0.1:' + server.address().port)
      assert.equal(req.method, 'POST')
      assert.equal(req.url, '/v1/chat/completions')
      assert(!('authorization' in req.headers), 'Local provider unexpectedly sent credentials')
      const chunks = []
      let bytes = 0
      for await (const chunk of req) {
        bytes += chunk.length
        assert(bytes < 1024 * 1024, 'Unexpectedly large fixture request')
        chunks.push(chunk)
      }
      const { model, messages, response_format } = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      assert(Array.isArray(messages))
      const prompt = messages.map(m => m.content).join('\n')
      Object.assign(call, { model, responseFormat: response_format?.type ?? null, promptSha256: hash(prompt),
        containsExactBody: prompt.includes(spec.body), hasTarget: prompt.includes(spec.target) })
      let content, finish = 'stop'
      if (model === 'retention-prose') {
        call.kind = 'prose'
        const dispatch = calls.filter(c => c.kind === 'prose').length
        assert(dispatch === 1 || (spec.negative === 'empty' && dispatch === 2 && !response_format),
          'Unexpected additional writing request')
        content = JSON.stringify({ title, body: spec.body })
        if (spec.negative === 'broken') content = '[' + content + ',' // Intact inner object in a broken outer envelope.
        if (spec.negative === 'empty') content = ''
        finish = spec.finish
      } else if (model === 'retention-extraction' && prompt.includes('foreshadowingExtraction')) {
        call.kind = 'extraction'
        content = JSON.stringify(extraction)
      } else if (model === 'retention-reviewer' && prompt.includes('You are a continuity editor')) {
        call.kind = 'consistency'
        if (spec.overflow && calls.filter(c => c.kind === 'consistency').length === 1) {
          await failureBarrier // The independent reader inspects committed SQLite before this 503 is sent.
          return reply(503, { error: { message: 'P0A_QA_REVIEW_OFFLINE' } })
        }
        content = JSON.stringify(consistency)
      } else if (model === 'retention-reviewer' && prompt.includes('overallScore')) {
        call.kind = 'quality'
        content = JSON.stringify(quality)
      } else {
        throw Error('Unexpected model or request type: ' + model)
      }
      Object.assign(call, { finishReason: finish ?? null, contentBytes: Buffer.byteLength(content), contentSha256: hash(content) })
      return reply(200, { id: spec.id + '-' + call.n, choices: [{ index: 0,
        message: { role: 'assistant', content }, ...(finish === undefined ? {} : { finish_reason: finish }) }],
        usage: { prompt_tokens: 71, completion_tokens: content ? 37 : 0, total_tokens: content ? 108 : 71 } })
    } catch (err) {
      call.unexpected = err.message
      if (!res.headersSent && !res.destroyed) reply(409, { error: { message: 'Unexpected QA request' } })
    }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  return { baseUrl: 'http://127.0.0.1:' + server.address().port + '/v1', calls, releaseFailure,
    async close() {
      releaseFailure()
      const closed = new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve()))
      server.closeAllConnections()
      await closed
    } }
}
