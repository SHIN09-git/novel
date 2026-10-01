import { mkdir, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import Database from 'better-sqlite3'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
const outDir = join(root, 'tmp', 'run-trace-author-summary-test')

function assert(condition, message, details = {}) {
  return condition ? { ok: true, message } : { ok: false, message, details }
}

async function bundle(entryPoint, outfileName) {
  const outfile = join(outDir, outfileName)
  await build({
    entryPoints: [join(root, entryPoint)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['better-sqlite3'],
    logLevel: 'silent'
  })
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
}

async function read(relativePath) {
  return readFile(join(root, relativePath), 'utf-8')
}

function now() {
  return '2026-05-10T00:00:00.000Z'
}

function baseTrace(overrides = {}) {
  return {
    id: 'trace-1',
    projectId: 'project-1',
    jobId: 'job-1',
    targetChapterOrder: 2,
    promptContextSnapshotId: null,
    contextSource: 'auto',
    selectedChapterIds: ['chapter-1'],
    selectedStageSummaryIds: [],
    selectedCharacterIds: ['character-1'],
    selectedForeshadowingIds: ['foreshadowing-1'],
    selectedTimelineEventIds: [],
    foreshadowingTreatmentModes: {},
    foreshadowingTreatmentOverrides: {},
    omittedContextItems: [{ type: 'character_state', id: 'state-1', reason: '预算不足且相关性较低', tokenEstimate: 120 }],
    contextWarnings: ['缺少角色伤势状态，可能导致恢复过快。'],
    contextTokenEstimate: 7000,
    forcedContextBlocks: [],
    compressionRecords: [],
    promptBlockOrder: [],
    finalPromptTokenEstimate: 9000,
    generatedDraftId: 'draft-1',
    consistencyReviewReportId: 'consistency-1',
    qualityGateReportId: 'quality-1',
    revisionSessionIds: [],
    acceptedRevisionVersionId: null,
    acceptedMemoryCandidateIds: [],
    rejectedMemoryCandidateIds: [],
    continuityBridgeId: null,
    continuitySource: null,
    redundancyReportId: 'redundancy-1',
    continuityWarnings: [],
    contextNeedPlanId: 'need-1',
    requiredCharacterCardFields: {},
    requiredStateFactCategories: { 'character-1': ['physical'] },
    contextNeedPlanWarnings: ['计划需要 physical 状态，但未找到确认事实。'],
    contextNeedPlanMatchedItems: [],
    contextNeedPlanOmittedItems: [{ type: 'character_state', id: 'state-1', reason: '未纳入 prompt', tokenEstimate: 120 }],
    includedCharacterStateFactIds: [],
    characterStateWarnings: ['右臂伤势未纳入正文上下文。'],
    characterStateIssueIds: ['state-issue-1'],
    noveltyAuditResult: {
      newNamedCharacters: [],
      newWorldRules: [{ kind: 'new_world_rule', text: '临时权限', evidenceExcerpt: '系统突然授予临时权限', reason: '未在任务书允许列表中', severity: 'fail', allowedByTask: false, hasPriorForeshadowing: false, sourceHint: null, suggestedAction: '删除或改写' }],
      newSystemMechanics: [],
      newOrganizationsOrRanks: [],
      majorLoreReveals: [],
      suspiciousDeusExRules: [],
      untracedNames: [],
      severity: 'fail',
      summary: '发现未授权临时权限。'
    },
    storyDirectionGuideId: null,
    storyDirectionGuideSource: null,
    storyDirectionGuideHorizon: null,
    storyDirectionGuideStartChapterOrder: null,
    storyDirectionGuideEndChapterOrder: null,
    storyDirectionBeatId: null,
    storyDirectionAppliedToChapterTask: false,
    createdAt: now(),
    updatedAt: now(),
    ...overrides
  }
}

function makeData(overrides = {}) {
  const longDraft = `正文开头。${'这是一段很长的正文，不能被复制进作者摘要。'.repeat(120)}`
  return {
    schemaVersion: 3,
    projects: [{ id: 'project-1', name: 'Project', genre: '', description: '', targetReaders: '', coreAppeal: '', style: '', createdAt: now(), updatedAt: now() }],
    storyBibles: [],
    chapters: [{ id: 'chapter-1', projectId: 'project-1', order: 1, title: '第一章', body: '旧正文', summary: '', newInformation: '', characterChanges: '', newForeshadowing: '', resolvedForeshadowing: '', endingHook: '', riskWarnings: '', includedInStageSummary: false, createdAt: now(), updatedAt: now() }],
    characters: [{ id: 'character-1', projectId: 'project-1', name: '林澈', role: '', profile: '', currentEmotionalState: '', relationshipWithProtagonist: '', nextActionTendency: '', createdAt: now(), updatedAt: now() }],
    characterStateLogs: [],
    characterStateFacts: [],
    characterStateTransactions: [],
    characterStateChangeCandidates: [],
    foreshadowings: [{ id: 'foreshadowing-1', projectId: 'project-1', title: '电梯规则', description: '', firstChapterOrder: 1, weight: 'high', status: 'unresolved', treatmentMode: 'hint', expectedPayoff: '', relatedCharacterIds: [], notes: '', createdAt: now(), updatedAt: now() }],
    timelineEvents: [],
    stageSummaries: [],
    promptVersions: [],
    promptContextSnapshots: [],
    storyDirectionGuides: [],
    contextNeedPlans: [{ id: 'need-1', projectId: 'project-1', targetChapterOrder: 2, source: 'generation_pipeline', chapterIntent: '检查右臂伤势', expectedSceneType: 'action', expectedCharacters: [], requiredCharacterCardFields: {}, requiredStateFactCategories: { 'character-1': ['physical'] }, requiredForeshadowingIds: [], forbiddenForeshadowingIds: [], requiredTimelineEventIds: [], requiredWorldbuildingKeys: [], mustCheckContinuity: ['injury'], retrievalPriorities: [], exclusionRules: [], warnings: [], createdAt: now(), updatedAt: now() }],
    chapterContinuityBridges: [],
    chapterGenerationJobs: [{ id: 'job-1', projectId: 'project-1', targetChapterOrder: 2, mode: 'standard', estimatedWordCount: '3000-5000', readerEmotionTarget: '紧张', status: 'completed', contextSource: 'auto', promptContextSnapshotId: null, createdAt: now(), updatedAt: now() }],
    chapterGenerationSteps: [{ id: 'step-1', jobId: 'job-1', type: 'quality_gate', status: 'completed', startedAt: now(), completedAt: now(), input: '', output: '', error: '' }],
    generatedChapterDrafts: [{ id: 'draft-1', projectId: 'project-1', jobId: 'job-1', chapterId: 'chapter-1', title: '第二章草稿', body: longDraft, summary: '', status: 'draft', tokenEstimate: 1000, createdAt: now(), updatedAt: now() }],
    memoryUpdateCandidates: [],
    consistencyReviewReports: [{ id: 'consistency-1', projectId: 'project-1', jobId: 'job-1', chapterId: 'chapter-1', issues: [{ id: 'issue-1', type: 'character_knowledge_leak', severity: 'high', title: '角色知道了不该知道的秘密', description: '林澈说出了未入账的系统秘密。', evidence: '他说出系统核心编号', relatedChapterIds: [], relatedCharacterIds: ['character-1'], relatedForeshadowingIds: [], suggestedFix: '改成猜测。', revisionInstruction: '修复知识越界。', status: 'open' }], suggestions: '', severitySummary: 'high', createdAt: now() }],
    contextBudgetProfiles: [],
    qualityGateReports: [{ id: 'quality-1', projectId: 'project-1', jobId: 'job-1', chapterId: 'chapter-1', draftId: 'draft-1', overallScore: 61, pass: false, dimensions: { plotCoherence: 60, characterConsistency: 60, characterStateConsistency: 50, foreshadowingControl: 55, chapterContinuity: 70, redundancyControl: 40, styleMatch: 70, pacing: 65, emotionalPayoff: 60, originality: 70, promptCompliance: 55, contextRelevanceCompliance: 45 }, issues: [{ severity: 'high', type: 'character_state', description: '右臂伤势被无解释忽略。', evidence: '正文中直接恢复挥剑。', suggestedFix: '保留伤势代价。' }], requiredFixes: ['修复伤势重置'], optionalSuggestions: [], createdAt: now() }],
    generationRunTraces: [baseTrace()],
    runTraceAuthorSummaries: [],
    redundancyReports: [{ id: 'redundancy-1', projectId: 'project-1', jobId: 'job-1', chapterId: 'chapter-1', draftId: 'draft-1', repeatedPhrases: [], repeatedSceneDescriptions: [], repeatedExplanations: [], overusedIntensifiers: [], redundantParagraphs: [], compressionSuggestions: ['删减重复解释电梯规则。'], overallRedundancyScore: 78, createdAt: now(), updatedAt: now() }],
    revisionCandidates: [],
    revisionSessions: [],
    revisionRequests: [],
    revisionVersions: [],
    chapterVersions: [],
    chapterCommitBundles: [],
    revisionCommitBundles: [],
    settings: { apiProvider: 'openai', apiKey: 'TEST_PLAINTEXT_KEY_SHOULD_NOT_PERSIST', hasApiKey: true, baseUrl: '', modelName: '', temperature: 0.8, maxTokens: 8000, enableAutoSummary: false, enableChapterDiagnostics: false, defaultTokenBudget: 16000, defaultPromptMode: 'standard', theme: 'system' },
    ...overrides
  }
}

async function main() {
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })
  const checks = []
  const serviceModule = await bundle('src/services/RunTraceAuthorSummaryService.ts', 'summary-service.mjs')
  const diagnosticBinding = await bundle('src/services/DraftDiagnosticBindingService.ts', 'diagnostic-binding.mjs')
  const defaultsModule = await bundle('src/shared/defaults.ts', 'defaults.mjs')
  const sqliteModule = await bundle('src/storage/SqliteStorageService.ts', 'sqlite-storage.mjs')
  const jsonModule = await bundle('src/storage/JsonStorageService.ts', 'json-storage.mjs')
  const panelSource = await read('src/renderer/src/components/pipeline/PipelineTracePanel.tsx')
  const runTests = await read('scripts/run-tests.mjs')

  const bindCurrentDiagnostics = (input) => {
    const draft = input.generatedChapterDrafts.find((item) => item.id === 'draft-1')
    if (!draft) return input
    const draftContentHash = diagnosticBinding.draftContentHash(draft.body)
    return {
      ...input,
      qualityGateReports: input.qualityGateReports.map((report) => ({
        ...report,
        draftId: draft.id,
        draftContentHash
      })),
      consistencyReviewReports: input.consistencyReviewReports.map((report) => ({
        ...report,
        draftId: draft.id,
        draftContentHash
      })),
      redundancyReports: input.redundancyReports.map((report) => ({
        ...report,
        draftId: draft.id,
        draftContentHash
      })),
      generationRunTraces: input.generationRunTraces.map((trace) => ({
        ...trace,
        noveltyAuditResult: trace.noveltyAuditResult
          ? {
              ...trace.noveltyAuditResult,
              sourceDraftId: draft.id,
              sourceContentHash: draftContentHash,
              auditedAt: now()
            }
          : null
      }))
    }
  }

  const data = bindCurrentDiagnostics(defaultsModule.normalizeAppData(makeData()))
  const summary = serviceModule.buildRunTraceAuthorSummary(data, { traceId: 'trace-1', createdAt: now() })
  checks.push(assert(summary.overallStatus === 'risky', 'high-risk reports produce risky author summary', summary))
  checks.push(assert(summary.likelyProblemSources.some((item) => item.source === 'quality_gate'), 'quality gate failure becomes a quality_gate source'))
  checks.push(assert(summary.likelyProblemSources.some((item) => item.source === 'consistency'), 'high consistency issue becomes a consistency source'))
  checks.push(assert(summary.likelyProblemSources.some((item) => item.source === 'novelty_drift'), 'novelty audit becomes a novelty_drift source'))
  checks.push(assert(summary.likelyProblemSources.some((item) => item.source === 'redundancy'), 'high redundancy report becomes a redundancy source'))
  checks.push(assert(summary.likelyProblemSources.some((item) => item.source === 'context_missing'), 'unmet context need becomes a context_missing source'))
  checks.push(assert(!summary.oneLineDiagnosis.includes('quality_gate'), 'author diagnosis uses readable Chinese labels instead of internal source enums'))
  checks.push(assert(!JSON.stringify(summary).includes('这是一段很长的正文'), 'summary does not copy full draft body'))
  checks.push(assert(!JSON.stringify(summary).includes('TEST_PLAINTEXT_KEY_SHOULD_NOT_PERSIST'), 'summary does not contain API keys'))

  const changedDraftData = {
    ...data,
    generatedChapterDrafts: data.generatedChapterDrafts.map((draft) =>
      draft.id === 'draft-1' ? { ...draft, body: `${draft.body}\n正文已经修订。`, updatedAt: '2026-05-10T01:00:00.000Z' } : draft
    )
  }
  const changedDraftSummary = serviceModule.buildRunTraceAuthorSummary(changedDraftData, { traceId: 'trace-1', createdAt: now() })
  checks.push(assert(
    !changedDraftSummary.likelyProblemSources.some((item) =>
      ['quality_gate', 'consistency', 'novelty_drift', 'redundancy'].includes(item.source)
    ),
    'author summary does not revive diagnostics bound to an older draft body',
    changedDraftSummary
  ))

  const regeneratedDraftData = {
    ...data,
    generatedChapterDrafts: [
      ...data.generatedChapterDrafts,
      {
        ...data.generatedChapterDrafts[0],
        id: 'draft-2',
        body: '同一运行重新生成的较新正文。',
        createdAt: '2026-05-10T01:00:00.000Z',
        updatedAt: '2026-05-10T01:00:00.000Z'
      }
    ]
  }
  const regeneratedDraftSummary = serviceModule.buildRunTraceAuthorSummary(regeneratedDraftData, { traceId: 'trace-1', createdAt: now() })
  checks.push(assert(
    regeneratedDraftSummary.generatedDraftId === 'draft-2' &&
      !regeneratedDraftSummary.likelyProblemSources.some((item) =>
        ['quality_gate', 'consistency', 'novelty_drift', 'redundancy'].includes(item.source)
      ),
    'author summary follows the newest draft when trace metadata lags behind regeneration',
    regeneratedDraftSummary
  ))

  const failedData = defaultsModule.normalizeAppData({
    ...makeData({ generationRunTraces: [baseTrace({ id: 'trace-failed', generatedDraftId: null, qualityGateReportId: null, consistencyReviewReportId: null, redundancyReportId: null, noveltyAuditResult: null })] }),
    chapterGenerationSteps: [{ id: 'failed-step', jobId: 'job-1', type: 'generate_chapter_draft', status: 'failed', startedAt: now(), completedAt: now(), input: '', output: '', error: 'schema mismatch' }],
    qualityGateReports: [],
    consistencyReviewReports: [],
    redundancyReports: []
  })
  const failedSummary = serviceModule.buildRunTraceAuthorSummary(failedData, { traceId: 'trace-failed', createdAt: now() })
  checks.push(assert(failedSummary.overallStatus === 'failed', 'failed step produces failed overallStatus'))

  const partialData = defaultsModule.normalizeAppData({
    ...makeData({ qualityGateReports: [], consistencyReviewReports: [], redundancyReports: [], generationRunTraces: [baseTrace({ qualityGateReportId: null, consistencyReviewReportId: null, redundancyReportId: null, noveltyAuditResult: null })] })
  })
  const partialSummary = serviceModule.buildRunTraceAuthorSummary(partialData, { traceId: 'trace-1', createdAt: now() })
  checks.push(assert(Boolean(partialSummary.oneLineDiagnosis), 'missing reports do not crash summary generation'))

  const advisoryContextData = defaultsModule.normalizeAppData({
    ...makeData({
      qualityGateReports: [],
      consistencyReviewReports: [],
      redundancyReports: [],
      generationRunTraces: [baseTrace({
        id: 'trace-advisory-context',
        qualityGateReportId: null,
        consistencyReviewReportId: null,
        redundancyReportId: null,
        noveltyAuditResult: null,
        omittedContextItems: [],
        contextWarnings: [],
        contextNeedPlanId: null,
        requiredStateFactCategories: {},
        contextNeedPlanWarnings: [],
        contextNeedPlanOmittedItems: [],
        characterStateWarnings: [],
        characterStateIssueIds: [],
        contextSelectionTrace: {
          projectId: 'project-1',
          chapterId: 'chapter-1',
          selectedBlocks: [],
          droppedBlocks: [{
            blockType: 'character',
            sourceId: 'character-advisory',
            priority: 'medium',
            uncertain: true,
            tokenEstimate: 80,
            dropReason: '角色只在中期导向中被提及。'
          }],
          unmetNeeds: [{
            needType: 'character_card',
            sourceId: 'character-advisory',
            priority: 'medium',
            uncertain: true,
            reason: '该角色是否在场尚未确认。'
          }],
          budgetSummary: { totalBudget: 12000, usedTokens: 3000, reservedTokens: 9000, pressure: 'low' }
        }
      })]
    }),
    chapterGenerationSteps: [{ id: 'advisory-step', jobId: 'job-1', type: 'quality_gate', status: 'completed', startedAt: now(), completedAt: now(), input: '', output: '', error: '' }]
  })
  const advisoryContextSummary = serviceModule.buildRunTraceAuthorSummary(advisoryContextData, {
    traceId: 'trace-advisory-context',
    createdAt: now()
  })
  checks.push(assert(
    !advisoryContextSummary.likelyProblemSources.some((item) => item.source === 'context_missing'),
    'uncertain advisory needs remain traceable without becoming a confirmed context failure',
    advisoryContextSummary.likelyProblemSources
  ))

  const allowedFinding = {
    kind: 'new_world_rule',
    text: '新副本门禁公告',
    evidenceExcerpt: '入口公告公开了门禁限制',
    reason: '本章任务书明确允许的新副本规则',
    severity: 'info',
    allowedByTask: true,
    hasPriorForeshadowing: false,
    sourceHint: 'chapter_allowed_novelty',
    suggestedAction: '保留审计记录'
  }
  const allowedNoveltyData = bindCurrentDiagnostics(defaultsModule.normalizeAppData({
    ...makeData({
      qualityGateReports: [],
      consistencyReviewReports: [],
      redundancyReports: [],
      generationRunTraces: [baseTrace({
        id: 'trace-allowed-novelty',
        qualityGateReportId: null,
        consistencyReviewReportId: null,
        redundancyReportId: null,
        omittedContextItems: [],
        contextWarnings: [],
        contextNeedPlanId: null,
        requiredStateFactCategories: {},
        contextNeedPlanWarnings: [],
        contextNeedPlanOmittedItems: [],
        characterStateWarnings: [],
        characterStateIssueIds: [],
        noveltyAuditResult: {
          newNamedCharacters: [],
          newWorldRules: [allowedFinding],
          newSystemMechanics: [],
          newOrganizationsOrRanks: [],
          majorLoreReveals: [],
          suspiciousDeusExRules: [],
          untracedNames: [],
          severity: 'pass',
          summary: '新增内容在任务书许可范围内。'
        }
      })]
    }),
    chapterGenerationSteps: [{ id: 'allowed-step', jobId: 'job-1', type: 'quality_gate', status: 'completed', startedAt: now(), completedAt: now(), input: '', output: '', error: '' }]
  }))
  const allowedNoveltySummary = serviceModule.buildRunTraceAuthorSummary(allowedNoveltyData, { traceId: 'trace-allowed-novelty', createdAt: now() })
  checks.push(assert(!allowedNoveltySummary.likelyProblemSources.some((item) => item.source === 'novelty_drift'), 'task-authorized info novelty remains traceable without becoming an author risk'))
  checks.push(assert(allowedNoveltySummary.continuityDiagnosis?.newCanonRisks?.length === 0, 'authorized info novelty is not mislabeled as a canon risk'))

  const crossProjectData = defaultsModule.normalizeAppData({
    ...makeData({
      projects: [
        ...makeData().projects,
        { id: 'project-2', name: 'Other Project', genre: '', description: '', targetReaders: '', coreAppeal: '', style: '', createdAt: now(), updatedAt: now() }
      ],
      generationRunTraces: [baseTrace({
        id: 'trace-cross-project',
        omittedContextItems: [],
        contextWarnings: [],
        contextNeedPlanId: null,
        requiredStateFactCategories: {},
        contextNeedPlanWarnings: [],
        contextNeedPlanOmittedItems: [],
        characterStateWarnings: [],
        characterStateIssueIds: [],
        noveltyAuditResult: null
      })],
      qualityGateReports: [{ ...makeData().qualityGateReports[0], projectId: 'project-2' }],
      consistencyReviewReports: [{ ...makeData().consistencyReviewReports[0], projectId: 'project-2' }],
      redundancyReports: [{ ...makeData().redundancyReports[0], projectId: 'project-2' }]
    })
  })
  const crossProjectSummary = serviceModule.buildRunTraceAuthorSummary(crossProjectData, { traceId: 'trace-cross-project', createdAt: now() })
  checks.push(assert(!crossProjectSummary.likelyProblemSources.some((item) => ['quality_gate', 'consistency', 'redundancy'].includes(item.source)), 'trace summary ignores report ids that belong to another project'))

  const upserted = serviceModule.upsertRunTraceAuthorSummaryToAppData(data, summary)
  const upsertedAgain = serviceModule.upsertRunTraceAuthorSummaryToAppData(upserted, { ...summary, oneLineDiagnosis: 'updated' })
  checks.push(assert(upsertedAgain.runTraceAuthorSummaries.length === 1 && upsertedAgain.runTraceAuthorSummaries[0].oneLineDiagnosis === 'updated', 'upsert is idempotent per trace'))

  const jsonPath = join(outDir, 'novel-director-data.json')
  const jsonStorage = new jsonModule.JsonStorageService(jsonPath)
  await jsonStorage.save(upsertedAgain)
  const jsonLoaded = await jsonStorage.load()
  checks.push(assert(jsonLoaded.runTraceAuthorSummaries.length === 1, 'JSON storage round-trips author summaries'))
  checks.push(assert(jsonLoaded.settings.apiKey === '', 'JSON storage sanitizes API key with author summaries'))

  const sqlitePath = join(outDir, 'novel-director-data.sqlite')
  const sqliteStorage = new sqliteModule.SqliteStorageService(sqlitePath)
  await sqliteStorage.save(upsertedAgain)
  const sqliteLoaded = await sqliteStorage.load()
  checks.push(assert(sqliteLoaded.runTraceAuthorSummaries.length === 1, 'SQLite storage round-trips author summaries'))
  const db = new Database(sqlitePath, { readonly: true })
  const leakedApiKey = db.prepare("select count(*) as count from entities where json like '%TEST_PLAINTEXT_KEY_SHOULD_NOT_PERSIST%'").get().count
  db.close()
  checks.push(assert(leakedApiKey === 0, 'SQLite entity JSON does not contain API key'))

  checks.push(assert(panelSource.includes('作者诊断摘要') && panelSource.includes('高级 / 调试信息'), 'PipelineTracePanel defaults to author summary and keeps advanced trace details'))
  checks.push(assert(panelSource.includes('生成诊断摘要') && panelSource.includes('source.evidence[0]'), 'active Run Trace panel exposes manual summary generation and author-facing evidence'))
  checks.push(assert(runTests.includes('validate-run-trace-author-summary.mjs'), 'npm test runs run trace author summary validation'))

  const failed = checks.filter((check) => !check.ok)
  const report = { ok: failed.length === 0, totalChecks: checks.length, failed }
  console.log(JSON.stringify(report, null, 2))
  if (failed.length) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
