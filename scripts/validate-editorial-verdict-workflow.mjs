import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
const outDir = join(root, 'tmp', 'editorial-verdict-workflow-test')
const timestamp = '2026-09-06T12:00:00.000Z'

function assert(condition, message, details = undefined) {
  if (!condition) throw new Error(`${message}${details ? `: ${JSON.stringify(details)}` : ''}`)
}

async function bundle(entryPoint, fileName) {
  const outfile = join(outDir, fileName)
  await build({
    entryPoints: [join(root, entryPoint)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent'
  })
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}-${fileName}`)
}

function quality(id, draft, hash, pass, createdAt, requiredFixes = []) {
  return {
    id, projectId: 'project-1', jobId: draft.jobId, chapterId: draft.chapterId, draftId: draft.id,
    draftContentHash: hash, overallScore: pass ? 88 : 42, pass, dimensions: {}, issues: [],
    requiredFixes, optionalSuggestions: [], createdAt
  }
}

function consistency(id, draft, hash, createdAt, issues = []) {
  return {
    id, projectId: 'project-1', jobId: draft.jobId, chapterId: draft.chapterId, draftId: draft.id,
    draftContentHash: hash, issues, suggestions: '', severitySummary: issues.length ? 'high' : 'low', createdAt
  }
}

function makeData(normalizeAppData, recipe, draft, reports = {}, options = {}) {
  const hash = reports.hash
  return normalizeAppData({
    schemaVersion: 3,
    projects: [{ id: 'project-1', name: '测试项目', createdAt: timestamp, updatedAt: timestamp }],
    chapters: options.includeChapter === false
      ? []
      : [{ id: 'chapter-1', projectId: 'project-1', order: 7, title: '第七章', body: '', createdAt: timestamp, updatedAt: timestamp }],
    chapterGenerationJobs: [{
      id: draft.jobId, projectId: 'project-1', targetChapterOrder: 7, contextSource: 'auto',
      pipelineMode: recipe.id === 'fast' ? 'aggressive' : 'standard', pipelineRecipeId: recipe.id,
      pipelineRecipeVersion: recipe.version, pipelineRecipe: recipe, status: 'completed',
      currentStep: 'await_user_confirmation', createdAt: timestamp, updatedAt: timestamp, errorMessage: ''
    }],
    chapterGenerationSteps: [{
      id: 'consistency-step', jobId: draft.jobId, type: 'consistency_review', status: recipe.id === 'fast' ? 'skipped' : 'completed',
      inputSnapshot: '', output: '', errorMessage: '', createdAt: timestamp, updatedAt: timestamp
    }],
    generatedChapterDrafts: [draft],
    qualityGateReports: reports.qualityGateReports ?? [quality('quality-current', draft, hash, true, timestamp)],
    consistencyReviewReports: reports.consistencyReviewReports ?? [consistency('consistency-current', draft, hash, timestamp)],
    generationRunTraces: [{
      id: 'trace-1', projectId: 'project-1', jobId: draft.jobId, targetChapterOrder: 7,
      generatedDraftId: draft.id, qualityGateReportId: reports.qualityGateReports?.[0]?.id ?? 'quality-current',
      consistencyReviewReportId: reports.consistencyReviewReports?.[0]?.id ?? 'consistency-current',
      createdAt: timestamp, updatedAt: timestamp
    }],
    memoryUpdateCandidates: [{
      id: 'candidate-1', projectId: 'project-1', jobId: draft.jobId, type: 'chapter_review', status: 'pending',
      title: '已处理候选', description: '', proposedPatch: { kind: 'legacy_raw', rawText: '' },
      createdAt: timestamp, updatedAt: timestamp
    }]
  })
}

async function main() {
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })
  const policy = await bundle('src/services/AuthorDecisionPolicyService.ts', 'policy.mjs')
  const verdictService = await bundle('src/services/EditorialVerdictService.ts', 'verdict.mjs')
  const recipes = await bundle('src/services/PipelineRecipeService.ts', 'recipes.mjs')
  const defaults = await bundle('src/shared/defaults.ts', 'defaults.mjs')
  const binding = await bundle('src/services/DraftDiagnosticBindingService.ts', 'binding.mjs')
  const director = await bundle('src/services/DirectorNextActionService.ts', 'director.mjs')
  const agentDecision = await bundle('src/agent/AgentDecisionService.ts', 'agent-decision.mjs')
  const acceptance = await bundle('src/renderer/src/views/generation/useDraftAcceptance.ts', 'acceptance.mjs')
  const { AuthorDecisionPolicyService } = policy
  const { buildEditorialVerdict } = verdictService
  const { PipelineRecipeService } = recipes
  const { normalizeAppData } = defaults
  const { draftContentHash } = binding
  const { useDraftAcceptance } = acceptance
  const { AgentDecisionService } = agentDecision

  const standard = PipelineRecipeService.getDefaultRecipe('standard')
  const draft = {
    id: 'draft-1', projectId: 'project-1', chapterId: 'chapter-1', jobId: 'job-1', title: '第七章草稿',
    body: '失败版本正文。', summary: '', status: 'draft', tokenEstimate: 20, createdAt: timestamp, updatedAt: timestamp
  }
  const failedHash = draftContentHash(draft.body)
  const failedData = makeData(normalizeAppData, standard, draft, {
    hash: failedHash,
    qualityGateReports: [quality('quality-failed', draft, failedHash, false, timestamp, ['修复冲突'])],
    consistencyReviewReports: [consistency('consistency-failed', draft, failedHash, timestamp, [{
      id: 'issue-1', type: 'previous_chapter_contradiction', severity: 'high', title: '衔接冲突', description: '位置冲突',
      evidence: '上一章在城外', relatedChapterIds: [], relatedCharacterIds: [], relatedForeshadowingIds: [], suggestedFix: '修订位置', revisionInstruction: '修订位置', status: 'open'
    }])]
  })
  const failedVerdict = buildEditorialVerdict({ appData: failedData, draftId: draft.id, createdAt: timestamp })
  const blocked = AuthorDecisionPolicyService.applyEditorialCoverage(failedVerdict, {
    recipeId: standard.id, consistency: true
  })
  assert(blocked.status === 'blocked' && !AuthorDecisionPolicyService.assessEditorialVerdict(blocked).canAccept, 'failed quality blocks ordinary acceptance')

  const revisedDraft = { ...draft, body: '修订后通过的正文。', updatedAt: '2026-09-06T13:00:00.000Z' }
  const revisedHash = draftContentHash(revisedDraft.body)
  const revisedData = makeData(normalizeAppData, standard, revisedDraft, {
    hash: revisedHash,
    qualityGateReports: [
      quality('quality-revised-pass', revisedDraft, revisedHash, true, '2026-09-06T13:01:00.000Z'),
      quality('quality-old-fail', revisedDraft, 'draft-v1-old', false, '2026-09-06T13:02:00.000Z', ['旧正文问题'])
    ],
    consistencyReviewReports: [consistency('consistency-revised-pass', revisedDraft, revisedHash, '2026-09-06T13:01:00.000Z')]
  })
  const revisedVerdict = buildEditorialVerdict({ appData: revisedData, draftId: revisedDraft.id, createdAt: '2026-09-06T13:02:00.000Z' })
  const approved = AuthorDecisionPolicyService.applyEditorialCoverage(revisedVerdict, {
    recipeId: standard.id, consistency: true
  })
  assert(approved.status === 'approved' && AuthorDecisionPolicyService.assessEditorialVerdict(approved).canAccept, 'revision passes and becomes acceptable')
  assert(AuthorDecisionPolicyService.latestEditorialVerdictForDraft([blocked, approved], revisedDraft)?.id === approved.id, 'latest verdict is bound to the current draft revision')
  revisedData.editorialVerdicts = [blocked, approved]

  let persisted = null
  const acceptanceHook = useDraftAcceptance({
    project: revisedData.projects[0],
    saveData: async (input) => {
      persisted = typeof input === 'function' ? input(revisedData) : input
      return { ok: true }
    },
    selectedJob: revisedData.chapterGenerationJobs[0],
    targetChapterOrder: 7,
    chapters: revisedData.chapters,
    qualityGateReports: revisedData.qualityGateReports,
    editorialVerdicts: revisedData.editorialVerdicts,
    confirmAction: async () => true,
    setPipelineMessage: () => {}
  })
  await acceptanceHook.acceptDraft(revisedDraft)
  assert(persisted?.generatedChapterDrafts.some((item) => item.id === revisedDraft.id && item.status === 'accepted'), 'latest passing verdict reaches actual draft acceptance')

  async function assertConfirmationRejectsCurrentChange(label, mutate) {
    const current = structuredClone(revisedData)
    const messages = []
    let saveCalls = 0
    const hook = useDraftAcceptance({
      project: current.projects[0],
      saveData: async (input) => {
        const next = typeof input === 'function' ? input(current) : input
        saveCalls += 1
        return { ok: true, data: next }
      },
      selectedJob: current.chapterGenerationJobs[0],
      targetChapterOrder: 7,
      chapters: current.chapters,
      qualityGateReports: current.qualityGateReports,
      editorialVerdicts: current.editorialVerdicts,
      confirmAction: async () => {
        mutate(current)
        return true
      },
      setPipelineMessage: (message) => messages.push(message)
    })
    await hook.acceptDraft(revisedDraft)
    assert(saveCalls === 0 && messages.some((message) => message.includes('确认期间已变化') || message.includes('编辑结论在确认期间已更新')),
      `${label} 在确认期间变化后拒绝写入`, { saveCalls, messages })
  }

  await assertConfirmationRejectsCurrentChange('draft', (current) => {
    current.generatedChapterDrafts = current.generatedChapterDrafts.map((item) =>
      item.id === revisedDraft.id ? { ...item, body: '确认期间变更的正文。' } : item
    )
  })
  await assertConfirmationRejectsCurrentChange('target chapter', (current) => {
    current.chapters = current.chapters.map((chapter) =>
      chapter.id === 'chapter-1' ? { ...chapter, title: '确认期间变更的章节标题' } : chapter
    )
  })
  await assertConfirmationRejectsCurrentChange('quality report', (current) => {
    current.qualityGateReports = current.qualityGateReports.map((report) =>
      report.id === 'quality-revised-pass' ? { ...report, overallScore: report.overallScore - 1 } : report
    )
  })
  await assertConfirmationRejectsCurrentChange('editorial verdict', (current) => {
    current.editorialVerdicts = current.editorialVerdicts.map((verdict) =>
      verdict.id === approved.id ? { ...verdict, summary: `${verdict.summary}（确认期间更新）` } : verdict
    )
  })

  const cleanDraft = { ...draft, id: 'draft-clean', chapterId: null, jobId: 'job-clean', body: '干净新章正文。', updatedAt: '2026-09-06T13:10:00.000Z' }
  const cleanHash = draftContentHash(cleanDraft.body)
  const cleanData = makeData(normalizeAppData, standard, cleanDraft, { hash: cleanHash }, { includeChapter: false })
  const cleanVerdict = buildEditorialVerdict({ appData: cleanData, draftId: cleanDraft.id, createdAt: '2026-09-06T13:10:00.000Z' })
  cleanData.editorialVerdicts = [cleanVerdict]
  let cleanConfirmations = 0
  let cleanPersisted = null
  const cleanAcceptance = useDraftAcceptance({
    project: cleanData.projects[0],
    saveData: async (input) => {
      cleanPersisted = typeof input === 'function' ? input(cleanData) : input
      return { ok: true }
    },
    selectedJob: cleanData.chapterGenerationJobs[0],
    targetChapterOrder: 7,
    chapters: cleanData.chapters,
    qualityGateReports: cleanData.qualityGateReports,
    editorialVerdicts: cleanData.editorialVerdicts,
    confirmAction: async () => { cleanConfirmations += 1; return true },
    setPipelineMessage: () => {}
  })
  await cleanAcceptance.acceptDraft(cleanDraft)
  assert(cleanConfirmations === 0 && cleanPersisted?.generatedChapterDrafts.some((item) => item.id === cleanDraft.id && item.status === 'accepted'),
    'clean new chapter acceptance requires no confirmation')

  const fast = PipelineRecipeService.getDefaultRecipe('fast')
  const fastDraft = { ...draft, id: 'draft-fast', jobId: 'job-fast', body: '快速正文。', updatedAt: timestamp }
  const fastHash = draftContentHash(fastDraft.body)
  const fastData = makeData(normalizeAppData, fast, fastDraft, { hash: fastHash, consistencyReviewReports: [] })
  const fastCovered = buildEditorialVerdict({
    appData: fastData,
    draftId: fastDraft.id,
    createdAt: timestamp,
    coverageExpectation: { recipeId: fast.id, consistency: false }
  })
  assert(fastCovered.status === 'approved' && fastCovered.canAccept, 'fast without requested consistency is not incomplete', fastCovered)

  const advisoryData = makeData(normalizeAppData, standard, revisedDraft, {
    hash: revisedHash,
    qualityGateReports: [quality('quality-advisory', revisedDraft, revisedHash, true, '2026-09-06T13:03:00.000Z')],
    consistencyReviewReports: [consistency('consistency-advisory', revisedDraft, revisedHash, '2026-09-06T13:03:00.000Z')]
  })
  advisoryData.qualityGateReports[0].overallScore = 72
  const advisoryVerdict = buildEditorialVerdict({ appData: advisoryData, draftId: revisedDraft.id, createdAt: '2026-09-06T13:04:00.000Z' })
  assert(advisoryVerdict.status === 'advisory' && advisoryVerdict.canAccept, 'review-range quality becomes an author advisory')
  let advisoryConfirmations = 0
  const advisoryAcceptance = useDraftAcceptance({
    project: advisoryData.projects[0], saveData: async () => ({ ok: true }), selectedJob: advisoryData.chapterGenerationJobs[0],
    targetChapterOrder: 7, chapters: advisoryData.chapters, qualityGateReports: advisoryData.qualityGateReports,
    editorialVerdicts: (advisoryData.editorialVerdicts = [advisoryVerdict]),
    confirmAction: async () => { advisoryConfirmations += 1; return false },
    setPipelineMessage: () => {}
  })
  await advisoryAcceptance.acceptDraft(revisedDraft)
  assert(advisoryConfirmations === 1, 'author sees one unified editorial confirmation instead of a second quality decision')

  const agentRecommendation = AgentDecisionService.buildAcceptanceRecommendation({
    ...revisedData, editorialVerdicts: [approved]
  }, revisedDraft.jobId)
  assert(agentRecommendation.recommendation === 'accept' && agentRecommendation.reasons[0] === approved.summary,
    'Agent and desktop acceptance read the same current editorial verdict')
  const staleAgentRecommendation = AgentDecisionService.buildAcceptanceRecommendation({
    ...revisedData,
    generatedChapterDrafts: [{ ...revisedDraft, body: `${revisedDraft.body}再次修改。`, updatedAt: '2026-09-06T14:00:00.000Z' }],
    editorialVerdicts: [approved],
    generationRunTraces: [{ ...revisedData.generationRunTraces[0], editorialVerdictId: approved.id }]
  }, revisedDraft.jobId)
  assert(staleAgentRecommendation.recommendation === 'wait', 'Agent refuses to reuse a verdict from an older draft revision')

  const dashboard = director.getDirectorDashboard({ ...revisedData, editorialVerdicts: [approved] }, 'project-1')
  assert(dashboard.actions[0]?.reason === approved.summary, 'Director prioritizes the current editorial verdict')
  assert(dashboard.pendingCandidateCount === 1, 'pending candidates do not lock draft acceptance')

  console.log('validate-editorial-verdict-workflow: all checks passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
