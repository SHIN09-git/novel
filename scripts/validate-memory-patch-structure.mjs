import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import ts from 'typescript'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
const outDir = join(root, 'tmp', 'memory-patch-structure-test')

function assert(condition, message, details = {}) {
  return condition ? { ok: true, message } : { ok: false, message, details }
}

function thrownMessage(action) {
  try {
    action()
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

async function read(relativePath) {
  return readFile(join(root, relativePath), 'utf-8')
}

async function compileTsModule(relativePath, replacements = []) {
  let source = await read(relativePath)
  for (const [from, to] of replacements) {
    source = source.replace(from, to)
  }
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      useDefineForClassFields: true
    }
  })
  await mkdir(outDir, { recursive: true })
  const outPath = join(outDir, `${relativePath.replace(/[\\/.:]/g, '-')}.mjs`)
  await writeFile(outPath, compiled.outputText, 'utf-8')
  return outPath
}

async function loadTsModule(relativePath, replacements = []) {
  const outPath = await compileTsModule(relativePath, replacements)
  return import(`${pathToFileURL(outPath).href}?t=${Date.now()}`)
}

async function bundleTsModule(relativePath, outfileName) {
  await mkdir(outDir, { recursive: true })
  const outfile = join(outDir, outfileName)
  await build({
    entryPoints: [join(root, relativePath)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent'
  })
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
}

async function main() {
  const checks = []
  const typesSource = [
    await read('src/shared/types.ts'),
    await read('src/shared/types/memory.ts')
  ].join('\n')
  const defaults = await bundleTsModule('src/shared/defaults.ts', 'defaults.mjs')
  const runnerSource = [
    await read('src/renderer/src/views/generation/usePipelineRunner.ts'),
    await read('src/renderer/src/views/generation/usePipelineRunnerCore.ts'),
    await read('src/renderer/src/views/generation/pipelineRunnerEngine.ts'),
    await read('src/renderer/src/views/generation/pipelineSteps/postDraftAnalysis.ts'),
    await read('src/renderer/src/views/generation/pipelineSteps/memoryExtraction.ts')
  ].join('\n')
  const chapterReviewAiSource = await read('src/services/ai/ChapterReviewAI.ts')
  const memorySource = await read('src/renderer/src/views/generation/useMemoryCandidates.ts')
  const memoryServiceSource = await read('src/services/MemoryCandidateService.ts')
  const memoryActionsSource = await read('src/renderer/src/views/generation/memoryCandidateActions.ts')
  const uiSource = await read('src/renderer/src/views/GenerationPipelineView.tsx')
  const memoryPanelSource = await read('src/renderer/src/components/pipeline/PipelineMemoryCandidatesPanel.tsx')
  const memoryActions = await bundleTsModule(
    'src/renderer/src/views/generation/memoryCandidateActions.ts',
    'memory-candidate-actions.mjs'
  )

  checks.push(
    assert(
      typesSource.includes('export type MemoryUpdatePatch') &&
        typesSource.includes('proposedPatch: MemoryUpdatePatch') &&
        !typesSource.includes('proposedPatch: string'),
      'MemoryUpdateCandidate.proposedPatch is a structured union, not string'
    )
  )

  const pendingCandidate = {
    id: 'idempotent-candidate',
    projectId: 'project-1',
    jobId: 'job-1',
    type: 'foreshadowing',
    targetId: null,
    proposedPatch: {
      schemaVersion: 1,
      kind: 'foreshadowing_create',
      summary: '新增钥匙伏笔',
      sourceChapterOrder: 2,
      warnings: [],
      candidate: {
        title: '银色钥匙',
        description: '钥匙会打开旧城门。',
        suggestedWeight: 'high',
        expectedPayoff: '第 5 章',
        relatedCharacterIds: [],
        notes: '',
        firstChapterOrder: 2,
        recommendedTreatmentMode: 'hint'
      }
    },
    evidence: '正文出现银色钥匙。',
    confidence: 0.8,
    status: 'pending',
    createdAt: 't',
    updatedAt: 't'
  }
  const idempotentBase = defaults.normalizeAppData({
    projects: [{
      id: 'project-1',
      name: '测试项目',
      genre: '',
      description: '',
      targetReaders: '',
      coreAppeal: '',
      style: '',
      createdAt: 't',
      updatedAt: 't'
    }],
    chapterGenerationJobs: [{
      id: 'job-1',
      projectId: 'project-1',
      targetChapterOrder: 2,
      contextSource: 'auto',
      status: 'completed',
      currentStep: null,
      createdAt: 't',
      updatedAt: 't',
      errorMessage: ''
    }],
    memoryUpdateCandidates: [pendingCandidate]
  })
  const applyArgs = {
    projectId: 'project-1',
    targetChapterOrder: 2,
    candidate: pendingCandidate,
    patch: pendingCandidate.proposedPatch,
    timestamp: 't2'
  }
  const appliedOnce = memoryActions.applyMemoryCandidatePatchToData({ current: idempotentBase, ...applyArgs })
  const appliedTwice = memoryActions.applyMemoryCandidatePatchToData({ current: appliedOnce, ...applyArgs })
  const rejectedAfterAccept = memoryActions.rejectMemoryCandidateInData(appliedTwice, pendingCandidate, 't3')
  checks.push(
    assert(
      appliedTwice.foreshadowings.length === 1 &&
        appliedTwice.memoryUpdateCandidates[0]?.status === 'accepted' &&
        rejectedAfterAccept.memoryUpdateCandidates[0]?.status === 'accepted',
      'memory candidate application is idempotent and stale reject cannot reverse an accepted candidate'
    )
  )

  const rejectedPending = memoryActions.rejectMemoryCandidateInData(idempotentBase, pendingCandidate, 't3')
  const appliedAfterReject = memoryActions.applyMemoryCandidatePatchToData({ current: rejectedPending, ...applyArgs })
  checks.push(
    assert(
      appliedAfterReject.foreshadowings.length === 0 && appliedAfterReject.memoryUpdateCandidates[0]?.status === 'rejected',
      'a rejected memory candidate cannot later be applied by a stale queued action'
    )
  )

  const stalePatchError = thrownMessage(() =>
    memoryActions.applyMemoryCandidatePatchToData({
      current: idempotentBase,
      ...applyArgs,
      patch: { ...pendingCandidate.proposedPatch, summary: 'stale caller patch' }
    })
  )
  checks.push(
    assert(
      stalePatchError.includes('补丁与已保存版本不匹配') &&
        idempotentBase.memoryUpdateCandidates[0]?.status === 'pending' &&
        idempotentBase.foreshadowings.length === 0,
      'stale caller patches throw before accepting or mutating the persisted candidate',
      { stalePatchError }
    )
  )

  const jobOrderCandidate = {
    ...pendingCandidate,
    id: 'job-order-candidate',
    proposedPatch: {
      ...pendingCandidate.proposedPatch,
      candidate: { ...pendingCandidate.proposedPatch.candidate, firstChapterOrder: null }
    }
  }
  const jobOrderData = memoryActions.applyMemoryCandidatePatchToData({
    current: { ...idempotentBase, memoryUpdateCandidates: [jobOrderCandidate] },
    projectId: 'project-1',
    targetChapterOrder: 99,
    candidate: jobOrderCandidate,
    patch: jobOrderCandidate.proposedPatch,
    timestamp: 't2'
  })
  checks.push(
    assert(
      jobOrderData.foreshadowings[0]?.firstChapterOrder === 2,
      'candidate target order comes from its persisted job instead of caller UI state'
    )
  )

  const projectTwo = {
    id: 'project-2',
    name: '另一个项目',
    genre: '',
    description: '',
    targetReaders: '',
    coreAppeal: '',
    style: '',
    createdAt: 't',
    updatedAt: 't'
  }
  const chapter = (id, projectId, order, summary = '') => ({
    id,
    projectId,
    order,
    title: `第 ${order} 章`,
    body: '',
    summary,
    newInformation: '',
    characterChanges: '',
    newForeshadowing: '',
    resolvedForeshadowing: '',
    endingHook: '',
    riskWarnings: '',
    includedInStageSummary: false,
    archivedAt: null,
    createdAt: 't',
    updatedAt: 't'
  })
  const reviewPatch = (targetChapterId, targetChapterOrder = null) => ({
    schemaVersion: 1,
    kind: 'chapter_review_update',
    summary: '章节复盘',
    sourceChapterOrder: 2,
    warnings: [],
    targetChapterId,
    targetChapterOrder,
    review: {
      summary: '只更新项目一',
      newInformation: '',
      characterChanges: '',
      newForeshadowing: '',
      resolvedForeshadowing: '',
      endingHook: '',
      riskWarnings: ''
    },
    continuityBridgeSuggestion: null
  })
  const reviewCandidate = (id, targetId, proposedPatch) => ({
    ...pendingCandidate,
    id,
    type: 'chapter_review',
    targetId,
    proposedPatch
  })
  const projectOneChapter = chapter('project-1-chapter-2', 'project-1', 2, '原摘要一')
  const projectOneOtherChapter = chapter('project-1-chapter-3', 'project-1', 3, '原摘要三')
  const projectTwoChapter = chapter('project-2-chapter-2', 'project-2', 2, '原摘要二')
  const reviewByJobPatch = reviewPatch(null)
  const reviewByJobCandidate = reviewCandidate('review-by-job', projectOneChapter.id, reviewByJobPatch)
  const reviewBase = {
    ...idempotentBase,
    projects: [...idempotentBase.projects, projectTwo],
    chapters: [projectTwoChapter, projectOneChapter, projectOneOtherChapter],
    memoryUpdateCandidates: [reviewByJobCandidate]
  }
  const reviewedData = memoryActions.applyMemoryCandidatePatchToData({
    current: reviewBase,
    projectId: 'project-1',
    targetChapterOrder: 99,
    candidate: reviewByJobCandidate,
    patch: reviewByJobPatch,
    timestamp: 't2'
  })
  checks.push(
    assert(
      reviewedData.chapters.find((item) => item.id === projectOneChapter.id)?.summary === '只更新项目一' &&
        reviewedData.chapters.find((item) => item.id === projectTwoChapter.id)?.summary === '原摘要二',
      'chapter review fallback selects the persisted job order only within the candidate project'
    )
  )

  const missingChapterPatch = reviewPatch('missing-chapter', 2)
  const missingChapterCandidate = reviewCandidate('missing-review-target', null, missingChapterPatch)
  const missingChapterError = thrownMessage(() =>
    memoryActions.applyMemoryCandidatePatchToData({
      current: { ...reviewBase, memoryUpdateCandidates: [missingChapterCandidate] },
      projectId: 'project-1',
      targetChapterOrder: 2,
      candidate: missingChapterCandidate,
      patch: missingChapterPatch,
      timestamp: 't2'
    })
  )
  const crossProjectChapterPatch = reviewPatch(projectTwoChapter.id, 2)
  const crossProjectChapterCandidate = reviewCandidate('cross-project-review-target', projectTwoChapter.id, crossProjectChapterPatch)
  const crossProjectChapterError = thrownMessage(() =>
    memoryActions.applyMemoryCandidatePatchToData({
      current: { ...reviewBase, memoryUpdateCandidates: [crossProjectChapterCandidate] },
      projectId: 'project-1',
      targetChapterOrder: 2,
      candidate: crossProjectChapterCandidate,
      patch: crossProjectChapterPatch,
      timestamp: 't2'
    })
  )
  const staleReviewPatch = reviewPatch(projectOneOtherChapter.id, 3)
  const staleReviewCandidate = reviewCandidate('stale-review-target', projectOneChapter.id, staleReviewPatch)
  const staleReviewTargetError = thrownMessage(() =>
    memoryActions.applyMemoryCandidatePatchToData({
      current: { ...reviewBase, memoryUpdateCandidates: [staleReviewCandidate] },
      projectId: 'project-1',
      targetChapterOrder: 2,
      candidate: staleReviewCandidate,
      patch: staleReviewPatch,
      timestamp: 't2'
    })
  )
  checks.push(
    assert(
      missingChapterError.includes('章节不存在') &&
        crossProjectChapterError.includes('章节不属于当前项目') &&
        staleReviewTargetError.includes('章节目标与已保存补丁不匹配'),
      'chapter review rejects invalid explicit IDs, cross-project targets, and stale same-project target identities',
      { missingChapterError, crossProjectChapterError, staleReviewTargetError }
    )
  )

  const foreshadowing = (id, projectId, status = 'unresolved') => ({
    id,
    projectId,
    title: id,
    firstChapterOrder: 1,
    description: '',
    status,
    weight: 'medium',
    treatmentMode: 'hint',
    expectedPayoff: '',
    payoffMethod: '',
    relatedCharacterIds: [],
    relatedMainPlot: '',
    notes: '',
    actualPayoffChapter: null,
    createdAt: 't',
    updatedAt: 't'
  })
  const statusPatch = (foreshadowingId) => ({
    schemaVersion: 1,
    kind: 'foreshadowing_status_update',
    summary: '推进伏笔',
    sourceChapterOrder: 2,
    warnings: [],
    foreshadowingId,
    suggestedStatus: 'partial',
    evidenceText: '本章再次出现',
    notes: '',
    confidence: 0.9
  })
  const statusCandidate = (id, targetId, proposedPatch) => ({
    ...pendingCandidate,
    id,
    type: 'foreshadowing',
    targetId,
    proposedPatch
  })
  const projectOneForeshadowing = foreshadowing('project-1-foreshadowing', 'project-1')
  const projectOneOtherForeshadowing = foreshadowing('project-1-other-foreshadowing', 'project-1')
  const projectTwoForeshadowing = foreshadowing('project-2-foreshadowing', 'project-2')
  const validStatusPatch = statusPatch(projectOneForeshadowing.id)
  const validStatusCandidate = statusCandidate('valid-status', projectOneForeshadowing.id, validStatusPatch)
  const statusBase = {
    ...idempotentBase,
    projects: [...idempotentBase.projects, projectTwo],
    foreshadowings: [projectOneForeshadowing, projectOneOtherForeshadowing, projectTwoForeshadowing],
    memoryUpdateCandidates: [validStatusCandidate]
  }
  const statusData = memoryActions.applyMemoryCandidatePatchToData({
    current: statusBase,
    projectId: 'project-1',
    targetChapterOrder: 99,
    candidate: validStatusCandidate,
    patch: validStatusPatch,
    timestamp: 't2'
  })
  const crossProjectStatusPatch = statusPatch(projectTwoForeshadowing.id)
  const crossProjectStatusCandidate = statusCandidate('cross-project-status', projectTwoForeshadowing.id, crossProjectStatusPatch)
  const crossProjectStatusError = thrownMessage(() =>
    memoryActions.applyMemoryCandidatePatchToData({
      current: { ...statusBase, memoryUpdateCandidates: [crossProjectStatusCandidate] },
      projectId: 'project-1',
      targetChapterOrder: 2,
      candidate: crossProjectStatusCandidate,
      patch: crossProjectStatusPatch,
      timestamp: 't2'
    })
  )
  const staleStatusPatch = statusPatch(projectOneOtherForeshadowing.id)
  const staleStatusCandidate = statusCandidate('stale-status', projectOneForeshadowing.id, staleStatusPatch)
  const staleStatusTargetError = thrownMessage(() =>
    memoryActions.applyMemoryCandidatePatchToData({
      current: { ...statusBase, memoryUpdateCandidates: [staleStatusCandidate] },
      projectId: 'project-1',
      targetChapterOrder: 2,
      candidate: staleStatusCandidate,
      patch: staleStatusPatch,
      timestamp: 't2'
    })
  )
  checks.push(
    assert(
      statusData.foreshadowings.find((item) => item.id === projectOneForeshadowing.id)?.status === 'partial' &&
        statusData.foreshadowings.find((item) => item.id === projectTwoForeshadowing.id)?.status === 'unresolved' &&
        crossProjectStatusError.includes('伏笔不属于当前项目') &&
        staleStatusTargetError.includes('伏笔目标与已保存补丁不匹配'),
      'foreshadowing status updates stay project-scoped and reject cross-project or stale target identities',
      { crossProjectStatusError, staleStatusTargetError }
    )
  )

  const targetedCreateCandidate = {
    ...pendingCandidate,
    id: 'targeted-foreshadowing-create',
    targetId: projectOneForeshadowing.id
  }
  const targetedCreateError = thrownMessage(() =>
    memoryActions.applyMemoryCandidatePatchToData({
      current: { ...statusBase, memoryUpdateCandidates: [targetedCreateCandidate] },
      projectId: 'project-1',
      targetChapterOrder: 2,
      candidate: targetedCreateCandidate,
      patch: targetedCreateCandidate.proposedPatch,
      timestamp: 't2'
    })
  )
  const crossProjectRelatedPatch = {
    ...pendingCandidate.proposedPatch,
    candidate: {
      ...pendingCandidate.proposedPatch.candidate,
      relatedCharacterIds: ['project-2-character']
    }
  }
  const crossProjectRelatedCandidate = {
    ...pendingCandidate,
    id: 'cross-project-related-foreshadowing',
    proposedPatch: crossProjectRelatedPatch
  }
  const crossProjectRelatedError = thrownMessage(() =>
    memoryActions.applyMemoryCandidatePatchToData({
      current: {
        ...statusBase,
        characters: [{ id: 'project-2-character', projectId: 'project-2' }],
        memoryUpdateCandidates: [crossProjectRelatedCandidate]
      },
      projectId: 'project-1',
      targetChapterOrder: 2,
      candidate: crossProjectRelatedCandidate,
      patch: crossProjectRelatedPatch,
      timestamp: 't2'
    })
  )
  checks.push(
    assert(
      targetedCreateError.includes('新增伏笔候选不应关联已有目标') &&
        crossProjectRelatedError.includes('伏笔关联角色不属于当前项目'),
      'foreshadowing creation rejects stale target IDs and cross-project related characters',
      { targetedCreateError, crossProjectRelatedError }
    )
  )

  checks.push(
    assert(
      runnerSource.includes("kind: 'chapter_review_update'") &&
        runnerSource.includes("kind: 'character_state_update'") &&
        runnerSource.includes("kind: 'foreshadowing_create'") &&
        runnerSource.includes("kind: 'foreshadowing_status_update'") &&
        !runnerSource.includes('proposedPatch: serializeOutput'),
      'new pipeline memory candidates create structured proposedPatch objects'
    )
  )

  checks.push(
    assert(
      chapterReviewAiSource.includes('const fallback: CharacterStateSuggestion[] = []') &&
        chapterReviewAiSource.includes('newForeshadowingCandidates: []') &&
        !chapterReviewAiSource.includes("title: '待确认新伏笔'") &&
        !chapterReviewAiSource.includes('请根据本章正文补充该角色是否发生长期状态变化') &&
        runnerSource.includes('hasChapterReviewMemoryContent') &&
        runnerSource.includes('reviewCandidates') &&
        runnerSource.includes('memoryUpdateCandidates: [...reviewCandidates'),
      'AI fallback review/extraction results do not create fake pending memory candidates'
    )
  )

  checks.push(
    assert(
      memoryActionsSource.includes("export * from '../../../../services/MemoryCandidateService'") &&
        !memoryActionsSource.includes('function applyMemoryCandidatePatchToData') &&
        !memoryServiceSource.includes('/renderer/') &&
        !memoryServiceSource.includes('renderer/src') &&
        typeof memoryActions.applyMemoryCandidatePatchToData === 'function' &&
        typeof memoryActions.resolveApplicableMemoryPatch === 'function' &&
        memorySource.includes('resolveApplicableMemoryPatch'),
      'renderer memory candidate facade re-exports the renderer-independent domain service'
    )
  )

  checks.push(
    assert(
      memorySource.includes('applyAllPendingCandidates') &&
        memorySource.includes('confirmQualityGateBypass') &&
        memoryPanelSource.includes('onAcceptAll') &&
        memoryPanelSource.includes('一键通过待确认'),
      'memory candidate panel supports one-click accepting pending structured candidates with the same confirmation guard'
    )
  )

  checks.push(
    assert(
      (uiSource.includes('renderMemoryPatchDetails') &&
        uiSource.includes("patch.kind === 'character_state_update'") &&
        uiSource.includes("patch.kind === 'foreshadowing_create'") &&
        !uiSource.includes('candidate.proposedPatch.slice')) ||
        (memoryPanelSource.includes('renderMemoryPatchDetails') &&
          memoryPanelSource.includes("patch.kind === 'character_state_update'") &&
          memoryPanelSource.includes("patch.kind === 'foreshadowing_create'") &&
          !memoryPanelSource.includes('candidate.proposedPatch.slice')),
      'GenerationPipelineView renders structured patch details instead of slicing raw JSON'
    )
  )

  const oldData = defaults.normalizeAppData({
    schemaVersion: 2,
    projects: [],
    memoryUpdateCandidates: [
      {
        id: 'review-candidate',
        projectId: 'project-1',
        jobId: 'job-1',
        type: 'chapter_review',
        targetId: null,
        proposedPatch: JSON.stringify({
          summary: '本章推进主角怀疑。',
          newInformation: '钥匙来自旧城。',
          characterChanges: '主角更谨慎。',
          newForeshadowing: '银色钥匙。',
          resolvedForeshadowing: '',
          endingHook: '门后有人。',
          riskWarnings: '不要立刻揭底。'
        }),
        evidence: '',
        confidence: 0.5,
        status: 'pending',
        createdAt: 't',
        updatedAt: 't'
      },
      {
        id: 'character-candidate',
        projectId: 'project-1',
        jobId: 'job-1',
        type: 'character',
        targetId: 'char-1',
        proposedPatch: JSON.stringify({ characterId: 'char-1', changeSummary: '她开始怀疑主角。' }),
        evidence: '',
        confidence: 0.5,
        status: 'pending',
        createdAt: 't',
        updatedAt: 't'
      },
      {
        id: 'new-foreshadowing',
        projectId: 'project-1',
        jobId: 'job-1',
        type: 'foreshadowing',
        targetId: null,
        proposedPatch: JSON.stringify({
          kind: 'new',
          candidate: { title: '银色钥匙', description: '钥匙会打开旧城门。', suggestedWeight: 'high', expectedPayoff: '第 5 章', relatedCharacterIds: [], notes: '' }
        }),
        evidence: '',
        confidence: 0.5,
        status: 'pending',
        createdAt: 't',
        updatedAt: 't'
      },
      {
        id: 'status-foreshadowing',
        projectId: 'project-1',
        jobId: 'job-1',
        type: 'foreshadowing',
        targetId: 'foreshadowing-1',
        proposedPatch: JSON.stringify({ kind: 'status', change: { foreshadowingId: 'foreshadowing-1', suggestedStatus: 'partial', evidenceText: '钥匙出现。' } }),
        evidence: '',
        confidence: 0.5,
        status: 'pending',
        createdAt: 't',
        updatedAt: 't'
      },
      {
        id: 'raw-candidate',
        projectId: 'project-1',
        jobId: 'job-1',
        type: 'character',
        targetId: null,
        proposedPatch: 'not-json',
        evidence: '',
        confidence: 0.5,
        status: 'pending',
        createdAt: 't',
        updatedAt: 't'
      }
    ]
  })

  const byId = new Map(oldData.memoryUpdateCandidates.map((candidate) => [candidate.id, candidate.proposedPatch]))
  checks.push(assert(byId.get('review-candidate')?.kind === 'chapter_review_update', 'old chapter review string converts to chapter_review_update'))
  checks.push(assert(byId.get('character-candidate')?.kind === 'character_state_update', 'old character string converts to character_state_update'))
  checks.push(assert(byId.get('new-foreshadowing')?.kind === 'foreshadowing_create', 'old new foreshadowing string converts to foreshadowing_create'))
  checks.push(assert(byId.get('status-foreshadowing')?.kind === 'foreshadowing_status_update', 'old status foreshadowing string converts to foreshadowing_status_update'))
  checks.push(
    assert(
      byId.get('raw-candidate')?.kind === 'legacy_raw' && byId.get('raw-candidate')?.rawText === 'not-json',
      'unrecognized old string becomes legacy_raw without losing rawText'
    )
  )

  const rawCandidate = oldData.memoryUpdateCandidates.find((candidate) => candidate.id === 'raw-candidate')
  const rawResolution = rawCandidate ? memoryActions.resolveApplicableMemoryPatch(rawCandidate) : null
  const mismatchedResolution = memoryActions.resolveApplicableMemoryPatch({
    ...pendingCandidate,
    id: 'mismatched-candidate',
    type: 'character'
  })
  checks.push(
    assert(
      rawResolution?.patch === null &&
        rawResolution.error?.includes('旧版原始文本') &&
        mismatchedResolution.patch === null &&
        mismatchedResolution.error?.includes('记忆候选类型与补丁类型不匹配'),
      'legacy_raw failures and type/kind mismatches are blocked by service behavior',
      { rawResolution, mismatchedResolution }
    )
  )

  const failed = checks.filter((check) => !check.ok)
  const report = { ok: failed.length === 0, totalChecks: checks.length, failed }
  console.log(JSON.stringify(report, null, 2))
  if (failed.length) process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
