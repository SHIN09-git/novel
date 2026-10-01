import { performance } from 'node:perf_hooks'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot

function assert(condition, message, details = {}) {
  if (!condition) throw new Error(`${message}\n${JSON.stringify(details, null, 2)}`)
}

async function loadHarness() {
  const source = `
    export * from './src/services/DraftDiagnosticBindingService'
    export * from './src/services/NoveltyDetector'
    export * from './src/services/ChapterCommitBundleService'
    export * from './src/services/PipelineRunContextService'
    export * from './src/services/AuthorDecisionPolicyService'
    export * from './src/agent/agentChapterSummaries'
    export * from './src/main/services/AIHttpClient'
    export * from './src/main/utils/aiErrors'
    export { EMPTY_APP_DATA } from './src/shared/defaults'
  `
  const output = await build({
    stdin: { contents: source, resolveDir: root, loader: 'ts' },
    write: false,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent'
  })
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`)
}

function iso(minute) {
  return `2026-08-07T00:${String(minute).padStart(2, '0')}:00.000Z`
}

function project(id) {
  return {
    id,
    name: '星期三（隔离测试）',
    genre: '规则怪谈',
    description: '',
    targetReaders: '',
    coreAppeal: '',
    style: '',
    createdAt: iso(0),
    updatedAt: iso(0)
  }
}

function qualityReport({ id, draft, hash, pass, score, minute }) {
  return {
    id,
    projectId: draft.projectId,
    jobId: draft.jobId,
    chapterId: draft.chapterId,
    draftId: draft.id,
    draftContentHash: hash,
    promptContextSnapshotId: null,
    overallScore: score,
    pass,
    dimensions: {},
    issues: [],
    requiredFixes: [],
    optionalSuggestions: [],
    createdAt: iso(minute)
  }
}

function trace(projectId, jobId, draftId, noveltyAuditResult) {
  return {
    id: 'trace-13',
    projectId,
    jobId,
    targetChapterOrder: 13,
    promptContextSnapshotId: null,
    contextSource: 'auto',
    selectedChapterIds: [],
    selectedStageSummaryIds: [],
    selectedCharacterIds: [],
    selectedForeshadowingIds: [],
    selectedTimelineEventIds: [],
    foreshadowingTreatmentModes: {},
    foreshadowingTreatmentOverrides: {},
    omittedContextItems: [],
    contextWarnings: [],
    contextTokenEstimate: 0,
    contextSelectionTrace: null,
    forcedContextBlocks: [],
    compressionRecords: [],
    promptBlockOrder: [],
    finalPromptTokenEstimate: 0,
    promptLintWarnings: [],
    promptLintIssueCount: 0,
    generatedDraftId: draftId,
    consistencyReviewReportId: 'consistency-old',
    qualityGateReportId: 'quality-old-fail',
    revisionSessionIds: [],
    acceptedRevisionVersionId: null,
    acceptedMemoryCandidateIds: [],
    rejectedMemoryCandidateIds: [],
    continuityBridgeId: null,
    continuitySource: null,
    redundancyReportId: 'redundancy-old',
    continuityWarnings: [],
    contextNeedPlanId: null,
    requiredCharacterCardFields: {},
    requiredStateFactCategories: {},
    contextNeedPlanWarnings: [],
    contextNeedPlanMatchedItems: [],
    contextNeedPlanOmittedItems: [],
    includedCharacterStateFactIds: [],
    characterStateWarnings: [],
    characterStateIssueIds: [],
    noveltyAuditResult,
    storyDirectionGuideId: null,
    storyDirectionGuideSource: null,
    storyDirectionGuideHorizon: null,
    storyDirectionGuideStartChapterOrder: null,
    storyDirectionGuideEndChapterOrder: null,
    storyDirectionBeatId: null,
    storyDirectionAppliedToChapterTask: false,
    hardCanonPackItemCount: 0,
    hardCanonPackTokenEstimate: 0,
    includedHardCanonItemIds: [],
    truncatedHardCanonItemIds: [],
    createdAt: iso(1),
    updatedAt: iso(1)
  }
}

async function verifyHttpTimeoutAndCancellation(harness) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, options) => {
    const signal = options?.signal
    return new Response(
      new ReadableStream({
        start(controller) {
          signal?.addEventListener(
            'abort',
            () => controller.error(Object.assign(new Error('aborted while reading body'), { name: 'AbortError' })),
            { once: true }
          )
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  try {
    const client = new harness.AIHttpClient()
    const timeoutStartedAt = performance.now()
    let timeoutError = null
    try {
      await client.post('https://example.invalid', {}, {}, { timeoutMs: 1_000 })
    } catch (error) {
      timeoutError = error
    }
    const timeoutElapsedMs = performance.now() - timeoutStartedAt
    assert(timeoutError instanceof harness.AiRequestTimeoutError, '悬挂请求必须以硬超时结束。', {
      name: timeoutError?.constructor?.name,
      timeoutElapsedMs
    })
    assert(timeoutElapsedMs >= 850 && timeoutElapsedMs < 1_800, '硬超时应在配置窗口附近结束。', {
      timeoutElapsedMs
    })

    const caller = new AbortController()
    const cancelStartedAt = performance.now()
    setTimeout(() => caller.abort(), 25)
    let cancelError = null
    try {
      await client.post('https://example.invalid', {}, {}, { timeoutMs: 5_000, signal: caller.signal })
    } catch (error) {
      cancelError = error
    }
    const cancelElapsedMs = performance.now() - cancelStartedAt
    assert(cancelError instanceof harness.AiRequestCancelledError, '用户取消必须与超时区分。', {
      name: cancelError?.constructor?.name,
      cancelElapsedMs
    })
    assert(cancelElapsedMs < 500, '取消信号应快速终止正文读取。', { cancelElapsedMs })
    return { timeoutElapsedMs, cancelElapsedMs }
  } finally {
    globalThis.fetch = originalFetch
  }
}

async function main() {
  const h = await loadHarness()

  const originalBody = '区域管理员-03宣布附加条款，便利店后门获得临时豁免。'
  const revisedBody = '周烬收回手，沿着走廊继续追查广播来源。'
  const draft = {
    id: 'draft-13',
    projectId: 'project-wednesday',
    chapterId: null,
    jobId: 'job-13',
    title: '第十三章',
    body: originalBody,
    summary: '',
    status: 'draft',
    tokenEstimate: 30,
    createdAt: iso(0),
    updatedAt: iso(1)
  }
  const originalHash = h.draftContentHash(originalBody)
  const revisedHash = h.draftContentHash(revisedBody)
  assert(originalHash !== revisedHash, '正文改动必须改变稳定 content hash。')

  const oldAudit = h.bindNoveltyAuditToDraft(
    h.NoveltyDetector.audit({ generatedText: originalBody, context: '', chapterPlan: null, knownCharacterNames: ['周烬'] }),
    draft,
    iso(2)
  )
  assert(oldAudit.newOrganizationsOrRanks.length > 0, '初稿应能检出区域管理员风险。')

  const data = structuredClone(h.EMPTY_APP_DATA)
  data.projects = [project(draft.projectId)]
  data.chapterGenerationJobs = [
    {
      id: draft.jobId,
      projectId: draft.projectId,
      targetChapterOrder: 13,
      promptContextSnapshotId: null,
      contextSource: 'auto',
      status: 'completed',
      currentStep: 'await_user_confirmation',
      createdAt: iso(0),
      updatedAt: iso(2),
      errorMessage: ''
    }
  ]
  data.chapterGenerationSteps = [
    'generate_chapter_draft',
    'generate_chapter_review',
    'propose_character_updates',
    'propose_foreshadowing_updates',
    'consistency_review',
    'quality_gate',
    'await_user_confirmation'
  ].map((type, index) => ({
    id: `step-${index}`,
    jobId: draft.jobId,
    type,
    status: 'completed',
    inputSnapshot: '',
    output: '',
    errorMessage: '',
    createdAt: iso(0),
    updatedAt: iso(2)
  }))
  data.generatedChapterDrafts = [draft]
  data.qualityGateReports = [qualityReport({ id: 'quality-old-fail', draft, hash: originalHash, pass: false, score: 42, minute: 2 })]
  data.generationRunTraces = [trace(draft.projectId, draft.jobId, draft.id, oldAudit)]
  data.runTraceAuthorSummaries = [
    {
      id: 'summary-old',
      projectId: draft.projectId,
      chapterId: 'chapter-13',
      jobId: draft.jobId,
      traceId: 'trace-13',
      generatedDraftId: draft.id,
      createdAt: iso(2),
      summaryVersion: 1,
      overallStatus: 'risky',
      oneLineDiagnosis: '旧正文诊断',
      likelyProblemSources: [],
      nextActions: [],
      sourceRefs: { qualityGateReportId: 'quality-old-fail', generationRunTraceId: 'trace-13' }
    }
  ]

  const staleReadData = {
    ...data,
    generatedChapterDrafts: [{ ...draft, body: revisedBody, updatedAt: iso(3) }]
  }
  const staleChapterState = h.getChapterProductionState(staleReadData, draft.projectId, 13)
  assert(staleChapterState.diagnostics.qualityGate === null, 'Agent 章节摘要不得展示与当前正文不匹配的旧质量报告。')
  const staleRunDiagnostics = h.getRunDiagnostics(staleReadData, draft.jobId)
  assert(staleRunDiagnostics.trace?.noveltySeverity === null, 'Agent Run 诊断不得展示旧初稿的 Novelty Audit 分级。')
  assert(staleRunDiagnostics.authorSummary === null, 'Agent Run 诊断不得展示正文修订前的作者摘要。')

  const invalidated = h.invalidateDraftDiagnosticsAfterChange(data, draft.id, revisedBody, iso(3))
  const currentDraft = invalidated.generatedChapterDrafts[0]
  assert(currentDraft.body === revisedBody, '修订正文必须写回当前 draft。')
  assert(invalidated.qualityGateReports.length === 1, '旧报告应保留为历史，不应被删除。')
  assert(!h.noveltyAuditMatchesDraft(oldAudit, currentDraft), '旧初稿 Novelty Audit 不得匹配修订正文。')
  assert(invalidated.generationRunTraces[0].noveltyAuditResult === null, '正文变化后 trace 必须解除旧 Novelty Audit。')
  assert(invalidated.runTraceAuthorSummaries.length === 0, '正文变化后旧作者诊断摘要必须失效。')
  assert(
    invalidated.chapterGenerationSteps.find((step) => step.type === 'generate_chapter_review')?.status === 'failed',
    '正文变化后必须从复盘步骤重新开始。'
  )
  assert(
    invalidated.chapterGenerationSteps.find((step) => step.type === 'quality_gate')?.status === 'pending',
    '旧质量门步骤必须失效为 pending。'
  )

  const freshAudit = h.bindNoveltyAuditToDraft(
    h.NoveltyDetector.audit({ generatedText: revisedBody, context: '', chapterPlan: null, knownCharacterNames: ['周烬'] }),
    currentDraft,
    iso(4)
  )
  assert(h.noveltyAuditMatchesDraft(freshAudit, currentDraft), '重审结果必须绑定当前正文。')
  assert(!JSON.stringify(freshAudit).includes('便利店'), '删除的便利店段落不得在重审结果中复活。')

  for (const phrase of ['她没有回应。', '然后她转过身。', '我伸手扶住门框。']) {
    const audit = h.NoveltyDetector.audit({ generatedText: phrase, context: '', chapterPlan: null, knownCharacterNames: [] })
    assert(audit.newNamedCharacters.length === 0, '普通中文短语不得被识别为新命名角色。', {
      phrase,
      findings: audit.newNamedCharacters
    })
  }
  const explicitNameAudit = h.NoveltyDetector.audit({
    generatedText: '“我叫顾临川。”他说。',
    context: '',
    chapterPlan: null,
    knownCharacterNames: []
  })
  assert(explicitNameAudit.newNamedCharacters.some((finding) => finding.text === '顾临川' && finding.confidence === 'high'), '明确自我介绍必须识别为高置信度新角色。')
  const attributionAudit = h.NoveltyDetector.audit({
    generatedText: '顾临川伸手按住门。',
    context: '',
    chapterPlan: null,
    knownCharacterNames: []
  })
  const attribution = attributionAudit.newNamedCharacters.find((finding) => finding.text === '顾临川')
  assert(attribution?.confidence === 'low' && attribution.severity !== 'fail', '仅凭动作归属识别的姓名必须降级，不能阻断采纳。', {
    attribution
  })

  const currentPass = qualityReport({
    id: 'quality-new-pass',
    draft: currentDraft,
    hash: revisedHash,
    pass: true,
    score: 88,
    minute: 5
  })
  const withPass = {
    ...invalidated,
    qualityGateReports: [invalidated.qualityGateReports[0], currentPass]
  }
  const candidateForCurrentRun = {
    id: 'memory-candidate-13',
    projectId: draft.projectId,
    jobId: draft.jobId,
    createdAt: iso(4)
  }
  assert(
    h.AuthorDecisionPolicyService.reportsForMemoryCandidates(
      [candidateForCurrentRun],
      withPass.qualityGateReports
    ).length === 0,
    '记忆候选确认必须使用同一 job 的最新质量报告，不能被旧失败报告继续阻断。'
  )
  assert(!Object.hasOwn(candidateForCurrentRun, 'proposedPatch'), '保留旧版最小候选输入，不能通过补 patch 掩盖兼容性崩溃。')
  const lateOldFailure = { ...invalidated.qualityGateReports[0], id: 'late-old-fail', createdAt: iso(6) }
  const unrelatedFailures = [
    { ...lateOldFailure, id: 'foreign-project-fail', projectId: 'another-project' },
    { ...lateOldFailure, id: 'foreign-job-fail', jobId: 'another-job' }
  ]
  const candidateReports = [...withPass.qualityGateReports, lateOldFailure, ...unrelatedFailures]
  const currentCandidateQuality = h.AuthorDecisionPolicyService.assessMemoryCandidateQuality(
    candidateForCurrentRun, candidateReports, withPass
  )
  assert(
    currentCandidateQuality.sourceStatus === 'current_draft' && currentCandidateQuality.report?.id === currentPass.id,
    '带来源上下文时，晚返回的旧 hash 失败报告不得覆盖当前草稿通过报告。'
  )
  assert(
    h.AuthorDecisionPolicyService.reportsForMemoryCandidates([candidateForCurrentRun], candidateReports, withPass).length === 0,
    '来源已匹配的候选不能被陈旧报告或其他项目、job 的报告重新提升为高风险。'
  )
  assert(
    h.AuthorDecisionPolicyService.reportsForMemoryCandidates([candidateForCurrentRun], unrelatedFailures).length === 0,
    '不传来源上下文的旧调用也必须隔离 project 和 job。'
  )
  for (const [candidate, context] of [
    [candidateForCurrentRun, { ...withPass, generatedChapterDrafts: [] }],
    [{ ...candidateForCurrentRun, createdAt: iso(2), updatedAt: iso(6) }, withPass]
  ]) {
    const unverified = h.AuthorDecisionPolicyService.assessMemoryCandidateQuality(candidate, [currentPass], context)
    assert(unverified.sourceStatus === 'unverified', '缺少来源或早于正文修订的旧候选不得被新通过报告认证。')
    assert(
      unverified.warnings.some((warning) => warning.includes('不代表当前正文审稿通过')),
      '无法溯源必须明确注明未验证，不能将历史通过报告当作当前候选已通过审稿。'
    )
  }
  const candidateWithNovelty = { ...candidateForCurrentRun, proposedPatch: { warnings: ['已有新规则风险'] } }
  const qualityWithNovelty = h.AuthorDecisionPolicyService.assessMemoryCandidateQuality(candidateWithNovelty, candidateReports, withPass)
  assert(qualityWithNovelty.warnings.includes('已有新规则风险'), '当前审稿通过不得剥离候选自身已记录的 novelty warning。')
  assert(candidateWithNovelty.proposedPatch.warnings.length === 1, '关联报告筛选不得改写候选自身 warnings。')
  assert(h.latestQualityReportForDraft(withPass.qualityGateReports, currentDraft)?.id === currentPass.id, '采纳必须选择与当前正文匹配且最新的通过报告。')
  assert(h.latestQualityReportForText(withPass.qualityGateReports, revisedBody)?.id === currentPass.id, '修订工作台必须按当前正文 hash 选择报告。')
  assert(h.latestQualityReportForText(withPass.qualityGateReports, '另一份修订正文') === null, '正文已变化时，旧报告必须失效。')
  const bundle = h.buildAcceptedDraftCommitBundle({
    appData: withPass,
    projectId: draft.projectId,
    draftId: draft.id,
    targetChapterOrder: 13,
    commitId: 'commit-13',
    chapterId: 'chapter-13',
    acceptedAt: iso(6)
  })
  assert(bundle.qualityGateReportId === currentPass.id, '事务提交必须引用当前通过报告，而不是旧失败报告。', {
    qualityGateReportId: bundle.qualityGateReportId
  })
  assert(bundle.qualityGateReports.length === 1 && bundle.qualityGateReports[0].id === currentPass.id, '提交包不得夹带旧正文报告。')
  const accepted = h.applyChapterCommitBundleToAppData(withPass, bundle)
  assert(accepted.chapters.find((chapter) => chapter.id === 'chapter-13')?.body === revisedBody, '采纳后的章节正文必须等于最新修订正文。')
  assert(accepted.generatedChapterDrafts.find((item) => item.id === draft.id)?.status === 'accepted', '采纳后 draft 状态必须更新。')

  const savedSettings = {
    ...h.EMPTY_APP_DATA.settings,
    modelName: 'deepseek-v4-flash',
    requestTimeoutMs: 420_000
  }
  const runConfig = h.createPipelineAIRunConfig({ ...savedSettings, modelName: 'deepseek-chat', requestTimeoutMs: 90_000 })
  const resolvedSettings = h.resolvePipelineRunSettings(runConfig, savedSettings)
  assert(resolvedSettings.modelName === 'deepseek-chat', '诊断与质量门必须继承本次运行模型快照。')
  assert(resolvedSettings.requestTimeoutMs === 90_000, '诊断与质量门必须继承本次运行硬超时。')
  assert(!('apiKey' in runConfig), '运行快照不得携带 API Key。')

  const timing = await verifyHttpTimeoutAndCancellation(h)
  console.log(
    JSON.stringify(
      {
        ok: true,
        verified: [
          'content-hash-binding',
          'stale-audit-invalidation',
          'latest-matching-quality-report',
          'legacy-candidate-source-assessment',
          'memory-candidate-project-job-isolation',
          'memory-candidate-late-stale-report',
          'revision-text-quality-binding',
          'fail-revise-pass-accept',
          'chinese-name-boundaries',
          'run-model-snapshot',
          'hard-timeout',
          'cancellation'
        ],
        timing
      },
      null,
      2
    )
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exit(1)
})
