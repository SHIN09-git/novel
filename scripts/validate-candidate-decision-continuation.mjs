#!/usr/bin/env node
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
const tempDir = join(root, 'tmp', 'validation', 'candidate-decision-continuation')
const timestamp = '2026-09-06T00:00:00.000Z'

function assert(condition, message, details = undefined) {
  if (!condition) {
    const suffix = details === undefined ? '' : `\n${JSON.stringify(details, null, 2)}`
    throw new Error(`${message}${suffix}`)
  }
}

async function loadRealServices() {
  await rm(tempDir, { recursive: true, force: true })
  await mkdir(tempDir, { recursive: true })
  const entries = {
    decisions: 'src/services/CandidateDecisionService.ts',
    planner: 'src/services/ContextNeedPlannerService.ts',
    prompt: 'src/services/PromptBuilderService.ts'
  }
  const bundles = {}
  await Promise.all(Object.entries(entries).map(async ([key, relativePath]) => {
    const outfile = join(tempDir, `${key}.mjs`)
    await build({
      entryPoints: [join(root, relativePath)],
      outfile,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      logLevel: 'silent',
      external: ['better-sqlite3', 'electron']
    })
    bundles[key] = outfile
  }))
  const cacheKey = Date.now()
  return {
    decisions: await import(`${pathToFileURL(bundles.decisions).href}?t=${cacheKey}-decisions`),
    planner: await import(`${pathToFileURL(bundles.planner).href}?t=${cacheKey}-planner`),
    prompt: await import(`${pathToFileURL(bundles.prompt).href}?t=${cacheKey}-prompt`)
  }
}

function project(id, name) {
  return { id, name, genre: '都市悬疑', description: '', targetReaders: '', coreAppeal: '', style: '克制、具体', createdAt: timestamp, updatedAt: timestamp }
}

function chapter(id, projectId, order, title, body) {
  return {
    id, projectId, order, title, body, summary: `${title}摘要`, newInformation: '', characterChanges: '',
    newForeshadowing: '', resolvedForeshadowing: '', endingHook: '门后传来一声金属碰撞。', riskWarnings: '',
    includedInStageSummary: false, createdAt: timestamp, updatedAt: timestamp
  }
}

function character(id, projectId, name) {
  return {
    id, projectId, name, role: '调查者', surfaceGoal: '查清仓库里的失窃记录', deepDesire: '', coreFear: '',
    selfDeception: '', knownInformation: '知道旧仓库有一把封存钥匙', unknownInformation: '',
    protagonistRelationship: '', emotionalState: '警觉', nextActionTendency: '先确认现场痕迹', forbiddenWriting: '',
    lastChangedChapter: 1, isMain: true, createdAt: timestamp, updatedAt: timestamp
  }
}

function job(id, projectId) {
  return {
    id, projectId, targetChapterOrder: 2, chapterTaskSnapshot: null, promptContextSnapshotId: null,
    contextSource: 'auto', status: 'completed', currentStep: null, createdAt: timestamp, updatedAt: timestamp,
    errorMessage: ''
  }
}

function fact(id, projectId, characterId, category, key, label, value, chapterId, order) {
  return {
    id, projectId, characterId, category, key, label, valueType: 'text', value, unit: '', linkedCardFields: [],
    trackingLevel: 'hard', promptPolicy: 'when_relevant', status: 'active', sourceChapterId: chapterId,
    sourceChapterOrder: order, evidence: '第一章正文中的明确动作。', confidence: 0.95, createdAt: timestamp, updatedAt: timestamp
  }
}

function stateCandidate(id, projectId, jobId, characterId, chapterId, proposedFact, evidence) {
  return {
    id, projectId, jobId, characterId, chapterId, chapterOrder: 1, candidateType: 'create_fact', targetFactId: null,
    proposedFact, proposedTransaction: null, beforeValue: null, afterValue: proposedFact.value, evidence,
    confidence: 0.96, riskLevel: 'high', status: 'pending', createdAt: timestamp, updatedAt: timestamp
  }
}

function memoryCandidate(id, projectId, jobId, event) {
  return {
    id, projectId, jobId, type: 'timeline_event', targetId: null,
    proposedPatch: {
      schemaVersion: 1, kind: 'timeline_event_create', summary: `${event.title}已发生`, sourceChapterOrder: 1,
      warnings: [], event
    },
    evidence: '第一章正文明确写出警报响起并指向封存门。', confidence: 0.94, status: 'pending', createdAt: timestamp, updatedAt: timestamp
  }
}

function emptySettings() {
  return {
    apiProvider: 'openai', apiKey: 'sk-test-only', hasApiKey: true, baseUrl: 'https://api.invalid/v1',
    modelName: 'fixture', codexCliPath: 'codex', codexCliModel: '', temperature: 0.7, maxTokens: 1000,
    retryEnabled: false, maxRetries: 0, requestTimeoutMs: 1000, pipelineModelRoles: {}, enableAutoSummary: false,
    enableChapterDiagnostics: false, defaultTokenBudget: 16000, defaultPromptMode: 'standard', theme: 'system'
  }
}

function makeFixture() {
  const projectOne = project('project-1', '封存仓库')
  const projectTwo = project('project-2', '另一部故事')
  const chapterOne = chapter('chapter-1', projectOne.id, 1, '封存门', '警报响起，林砚的左掌被金属边缘划出一道银色细痕。')
  const characterOne = character('character-1', projectOne.id, '林砚')
  const foreignCharacter = character('character-2', projectTwo.id, '外部角色')
  const acceptedEvent = {
    id: 'event-alarm-1', projectId: projectOne.id, title: '封存门警报响起', chapterOrder: 1, storyTime: '夜间', narrativeOrder: 1,
    participantCharacterIds: [characterOne.id], result: '封存门进入警戒状态', downstreamImpact: '下一章必须核对钥匙与伤势', createdAt: timestamp, updatedAt: timestamp
  }
  const physicalFact = fact('fact-scar-1', projectOne.id, characterOne.id, 'physical', 'left-palm-scar', '左掌银色细痕', '左掌有一道银色细痕', chapterOne.id, 1)
  const rejectedInventoryFact = fact('fact-sealed-key-rejected', projectOne.id, characterOne.id, 'inventory', 'sealed-key', '封存钥匙', '林砚已经把封存钥匙藏进袖口', chapterOne.id, 1)
  const foreignFact = fact('fact-foreign', projectTwo.id, foreignCharacter.id, 'physical', 'foreign-injury', '另一故事的伤势', '不可串入本章的外部伤势', 'foreign-chapter-1', 1)
  const base = {
    schemaVersion: 3,
    projects: [projectOne, projectTwo],
    storyBibles: [
      { projectId: projectOne.id, worldbuilding: '仓库由旧式机械锁守护。', corePremise: '调查者追查失窃记录。', protagonistDesire: '', protagonistFear: '', mainConflict: '警报和封存钥匙形成时间压力。', powerSystem: '', bannedTropes: '', styleSample: '', narrativeTone: '', immutableFacts: '', updatedAt: timestamp },
      { projectId: projectTwo.id, worldbuilding: '外部世界设定。', corePremise: '', protagonistDesire: '', protagonistFear: '', mainConflict: '', powerSystem: '', bannedTropes: '', styleSample: '', narrativeTone: '', immutableFacts: '', updatedAt: timestamp }
    ],
    chapters: [chapterOne, chapter('foreign-chapter-1', projectTwo.id, 1, '外部报告', '外部故事正文。')],
    characters: [characterOne, foreignCharacter],
    characterStateLogs: [{ id: 'log-old', projectId: projectOne.id, characterId: characterOne.id, chapterId: chapterOne.id, chapterOrder: 1, note: '旧日志：林砚保持警觉，但不是本次硬状态事实。', createdAt: timestamp }],
    characterStateFacts: [foreignFact],
    characterStateTransactions: [],
    characterStateChangeCandidates: [],
    foreshadowings: [], timelineEvents: [], stageSummaries: [], promptVersions: [], promptContextSnapshots: [],
    storyDirectionGuides: [], hardCanonPacks: [], contextNeedPlans: [], chapterContinuityBridges: [],
    chapterGenerationJobs: [], chapterGenerationSteps: [], generatedChapterDrafts: [], memoryUpdateCandidates: [],
    candidateDecisionReceipts: [], consistencyReviewReports: [], contextBudgetProfiles: [],
    qualityGateReports: [{ id: 'old-report-foreign', projectId: projectTwo.id, jobId: 'job-foreign', chapterId: 'foreign-chapter-1', status: 'failed', summary: 'OLD REPORT MUST NOT ENTER NEXT CHAPTER PROMPT', issues: [], createdAt: timestamp, updatedAt: timestamp }],
    generationRunTraces: [], runTraceAuthorSummaries: [], redundancyReports: [], editorialVerdicts: [], revisionCandidates: [],
    revisionSessions: [], revisionRequests: [], revisionVersions: [], chapterVersions: [], chapterCommitBundles: [], revisionCommitBundles: [],
    agentRuns: [], agentActionPreviews: [], settings: emptySettings()
  }
  base.chapterGenerationJobs = [job('job-1', projectOne.id), job('job-foreign', projectTwo.id)]
  base.memoryUpdateCandidates = [memoryCandidate('memory-alarm-1', projectOne.id, 'job-1', acceptedEvent)]
  base.characterStateChangeCandidates = [
    stateCandidate('state-scar-1', projectOne.id, 'job-1', characterOne.id, chapterOne.id, physicalFact, '第一章明确写出左掌被金属边缘划伤。'),
    stateCandidate('state-key-reject-1', projectOne.id, 'job-1', characterOne.id, chapterOne.id, rejectedInventoryFact, '报告推测林砚已取得封存钥匙，但正文没有这件事。'),
    stateCandidate('state-foreign-1', projectTwo.id, 'job-foreign', foreignCharacter.id, 'foreign-chapter-1', foreignFact, '外部故事候选。')
  ]
  return { base, projectOne, projectTwo, chapterOne, characterOne, foreignCharacter, physicalFact, rejectedInventoryFact, foreignFact }
}

function scopedProjectData(data, projectId) {
  const scoped = { ...data }
  const projectKeys = [
    'projects', 'storyBibles', 'chapters', 'characters', 'characterStateLogs', 'characterStateFacts', 'characterStateTransactions',
    'characterStateChangeCandidates', 'foreshadowings', 'timelineEvents', 'stageSummaries', 'promptVersions', 'promptContextSnapshots',
    'storyDirectionGuides', 'hardCanonPacks', 'contextNeedPlans', 'chapterContinuityBridges', 'chapterGenerationJobs', 'chapterGenerationSteps',
    'generatedChapterDrafts', 'memoryUpdateCandidates', 'candidateDecisionReceipts', 'consistencyReviewReports', 'contextBudgetProfiles',
    'qualityGateReports', 'generationRunTraces', 'runTraceAuthorSummaries', 'redundancyReports', 'editorialVerdicts', 'revisionCandidates',
    'revisionSessions', 'revisionRequests', 'revisionVersions', 'chapterVersions', 'chapterCommitBundles', 'revisionCommitBundles',
    'agentRuns', 'agentActionPreviews'
  ]
  for (const key of projectKeys) {
    if (Array.isArray(scoped[key])) scoped[key] = scoped[key].filter((item) => item.projectId === projectId)
  }
  return scoped
}

function task() {
  return {
    goal: '林砚检查封存门警报，确认左掌伤势，并用封存钥匙打开门。',
    conflict: '警报持续，伤势影响行动；钥匙是否真的在手中必须核实。',
    suspenseToKeep: '封存门后的声响来源。',
    allowedPayoffs: '', forbiddenPayoffs: '', endingHook: '门后的机械锁开始转动。', readerEmotion: '紧张', targetWordCount: '2500', styleRequirement: '具体、克制。'
  }
}

function plannerInput(data, project, chapterOne, characterOne) {
  return {
    project,
    storyBible: data.storyBibles.find((item) => item.projectId === project.id) ?? null,
    targetChapterOrder: 2,
    chapterTaskDraft: task(),
    previousChapter: chapterOne,
    continuityBridge: null,
    characters: [characterOne],
    characterStateFacts: data.characterStateFacts,
    foreshadowing: [],
    timelineEvents: data.timelineEvents,
    stageSummaries: [],
    source: 'auto'
  }
}

function promptInput(data, project, characterOne, contextNeedPlan) {
  return {
    project,
    bible: data.storyBibles.find((item) => item.projectId === project.id) ?? null,
    chapters: data.chapters,
    characters: [characterOne],
    characterStateLogs: data.characterStateLogs,
    characterStateFacts: data.characterStateFacts,
    foreshadowings: [],
    timelineEvents: data.timelineEvents,
    stageSummaries: [],
    contextNeedPlan,
    config: {
      projectId: project.id, targetChapterOrder: 2, mode: 'standard', modules: {
        bible: true, progress: true, recentChapters: true, characters: true, foreshadowing: false,
        stageSummaries: false, timeline: true, chapterTask: true, forbidden: true, outputFormat: true
      }, task: task(), selectedCharacterIds: [characterOne.id], selectedForeshadowingIds: [], useContinuityBridge: false
    }
  }
}

async function main() {
  const { decisions, planner, prompt } = await loadRealServices()
  const { previewCandidateDecisions, applyCandidateDecisionCommand, candidateDecisionChanges, applyCandidateDecisionChanges } = decisions
  const { ContextNeedPlannerService } = planner
  const { PromptBuilderService } = prompt
  const fixture = makeFixture()
  const initial = fixture.base
  const checks = []
  const check = (condition, message, details) => { assert(condition, message, details); checks.push(message) }

  const preview = previewCandidateDecisions(initial, {
    projectId: fixture.projectOne.id,
    decisions: [
      { kind: 'memory', candidateId: 'memory-alarm-1', decision: 'accept' },
      { kind: 'character_state', candidateId: 'state-scar-1', decision: 'accept' }
    ]
  })
  check(preview.items.length === 2, 'preview keeps the memory and hard-state candidates in one story-event decision group')
  check(new Set(preview.items.map((item) => item.evidence)).size === 2, 'preview retains evidence for both cross-module candidates')
  check(preview.items.every((item) => item.expectedFingerprint.startsWith('decision-v1-')), 'preview fingerprints are supplied for each executable selection')

  const acceptCommand = {
    id: 'decision-continuation-accept-1', projectId: fixture.projectOne.id, actor: { kind: 'user' },
    reason: '确认第一章正文明确的事件和硬状态。', decidedAt: '2026-09-06T00:01:00.000Z', schemaVersion: 1,
    confirmedHighRisk: true,
    decisions: preview.items.map(({ kind, candidateId, decision, expectedFingerprint }) => ({ kind, candidateId, decision, expectedFingerprint }))
  }
  const applied = applyCandidateDecisionCommand(initial, acceptCommand)
  check(applied.replayed === false, 'first continuation command applies instead of replaying')
  check(applied.data.memoryUpdateCandidates.find((item) => item.id === 'memory-alarm-1')?.status === 'accepted', 'accepted memory candidate becomes an accepted fact source')
  check(applied.data.characterStateChangeCandidates.find((item) => item.id === 'state-scar-1')?.status === 'accepted', 'accepted character-state candidate becomes accepted')
  check(applied.data.timelineEvents.some((item) => item.id === 'event-alarm-1' && item.projectId === fixture.projectOne.id), 'accepted memory candidate creates the physical timeline event')
  check(applied.data.characterStateFacts.some((item) => item.id === fixture.physicalFact.id && item.category === 'physical' && item.value === fixture.physicalFact.value), 'accepted hard-state candidate creates the physical fact')
  check(initial.timelineEvents.length === 0 && initial.characterStateFacts.length === 1, 'candidate apply keeps the synthetic input immutable')
  check(applied.data.candidateDecisionReceipts.length === 1, 'candidate apply leaves one decision receipt for the group')

  const changes = candidateDecisionChanges(initial, applied.data)
  const merged = applyCandidateDecisionChanges(initial, changes)
  check(merged.timelineEvents.some((item) => item.id === 'event-alarm-1'), 'real candidateDecisionChanges/applyCandidateDecisionChanges preserves the accepted event')
  check(merged.characterStateFacts.some((item) => item.id === fixture.physicalFact.id), 'real candidateDecisionChanges/applyCandidateDecisionChanges preserves the accepted state fact')
  check(merged.candidateDecisionReceipts.length === 1, 'real change merge retains the receipt needed by the save queue')

  const scopedAccepted = scopedProjectData(applied.data, fixture.projectOne.id)
  const plan = ContextNeedPlannerService.buildFromChapterIntent(plannerInput(scopedAccepted, fixture.projectOne, fixture.chapterOne, fixture.characterOne))
  const categories = plan.requiredStateFactCategories[fixture.characterOne.id] ?? []
  check(categories.includes('physical'), 'ContextNeedPlan explicitly requires physical state for the next chapter')
  check(categories.includes('inventory'), 'ContextNeedPlan explicitly requires inventory state for the next chapter')
  check(plan.contextNeeds.some((item) => item.sourceHint === 'character_state'), 'ContextNeedPlan emits a character_state retrieval need')
  check(plan.contextNeeds.some((item) => item.sourceHint === 'timeline' && item.sourceId === 'event-alarm-1'), 'ContextNeedPlan carries the accepted event as a timeline anchor')

  const acceptedPrompt = PromptBuilderService.buildResult(promptInput(scopedAccepted, fixture.projectOne, fixture.characterOne, plan))
  check(acceptedPrompt.finalPrompt.includes('左掌银色细痕') && acceptedPrompt.finalPrompt.includes('左掌有一道银色细痕'), 'final Prompt contains the accepted physical fact, not only the state log')
  check(acceptedPrompt.finalPrompt.includes('封存门警报响起'), 'final Prompt contains the accepted event from the timeline ledger')
  check(acceptedPrompt.finalPrompt.includes('警报持续'), 'final Prompt still contains the chapter task after context planning')

  const rejectPreview = previewCandidateDecisions(applied.data, {
    projectId: fixture.projectOne.id,
    decisions: [{ kind: 'character_state', candidateId: 'state-key-reject-1', decision: 'reject' }]
  })
  const rejected = applyCandidateDecisionCommand(applied.data, {
    id: 'decision-continuation-reject-1', projectId: fixture.projectOne.id, actor: { kind: 'user' },
    reason: '正文未证明钥匙已经在手中。', decidedAt: '2026-09-06T00:02:00.000Z', schemaVersion: 1,
    decisions: rejectPreview.items.map(({ kind, candidateId, decision, expectedFingerprint }) => ({ kind, candidateId, decision, expectedFingerprint }))
  })
  check(rejected.data.characterStateChangeCandidates.find((item) => item.id === 'state-key-reject-1')?.status === 'rejected', 'rejecting the unsupported inventory candidate records rejection')
  check(!rejected.data.characterStateFacts.some((item) => item.id === fixture.rejectedInventoryFact.id), 'rejected inventory candidate creates no accepted fact')
  const rejectedScoped = scopedProjectData(rejected.data, fixture.projectOne.id)
  const rejectedPlan = ContextNeedPlannerService.buildFromChapterIntent(plannerInput(rejectedScoped, fixture.projectOne, fixture.chapterOne, fixture.characterOne))
  const rejectedPrompt = PromptBuilderService.buildResult(promptInput(rejectedScoped, fixture.projectOne, fixture.characterOne, rejectedPlan))
  check(!rejectedPrompt.finalPrompt.includes('封存钥匙') || !rejectedPrompt.finalPrompt.includes('已经把封存钥匙藏进袖口'), 'rejected candidate does not enter the next Prompt as a state fact')

  const allText = `${rejectedPrompt.finalPrompt}\n${JSON.stringify(rejectedPlan)}`
  check(!allText.includes('OLD REPORT MUST NOT ENTER NEXT CHAPTER PROMPT'), 'old quality report text does not leak into the next chapter context')
  check(!allText.includes('另一故事的伤势') && !allText.includes('外部角色'), 'different-project state and characters do not leak into the next chapter context')
  check(!rejectedPrompt.finalPrompt.includes('外部故事正文'), 'different-project chapter text does not leak into the final Prompt')

  console.log(`Candidate decision continuation validation passed: ${checks.length} checks.`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
