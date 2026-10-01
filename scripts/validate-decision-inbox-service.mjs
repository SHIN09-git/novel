import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { repoRoot } from './utils/repo-root.mjs'

const outDir = join(repoRoot, 'tmp', 'decision-inbox-service-test')
const sourcePath = join(repoRoot, 'src', 'services', 'DecisionInboxService.ts')

function check(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`  ok - ${message}`)
}

async function loadService() {
  const source = await readFile(sourcePath, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove
    }
  })
  await mkdir(outDir, { recursive: true })
  const outputPath = join(outDir, 'DecisionInboxService.mjs')
  await writeFile(outputPath, compiled.outputText, 'utf8')
  return import(`${pathToFileURL(outputPath).href}?t=${Date.now()}`)
}

const timestamp = '2026-09-06T10:00:00.000Z'

function memoryCandidate(overrides = {}) {
  return {
    id: 'memory-1',
    projectId: 'project-1',
    jobId: 'job-11',
    type: 'character',
    targetId: 'character-1',
    proposedPatch: {
      schemaVersion: 1,
      kind: 'character_state_update',
      summary: '右手结晶化',
      sourceChapterOrder: 11,
      warnings: [],
      characterId: 'character-1',
      relatedChapterId: 'chapter-11',
      relatedChapterOrder: 11,
      changeSummary: '右手结晶化',
      newCurrentEmotionalState: '',
      newRelationshipWithProtagonist: '',
      newNextActionTendency: ''
    },
    evidence: '右手结晶化，成为与聚合体沟通的媒介。',
    confidence: 0.78,
    status: 'pending',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  }
}

function stateCandidate(overrides = {}) {
  return {
    id: 'state-1',
    projectId: 'project-1',
    jobId: 'job-11',
    characterId: 'character-1',
    chapterId: 'chapter-11',
    chapterOrder: 11,
    candidateType: 'create_fact',
    targetFactId: null,
    proposedFact: {
      id: 'fact-proposed-1',
      projectId: 'project-1',
      characterId: 'character-1',
      category: 'physical',
      key: 'right-hand-crystal',
      label: '右手结晶化',
      valueType: 'text',
      value: '右手结晶化，成为与聚合体沟通的媒介。',
      unit: '',
      linkedCardFields: ['weaknessAndCost', 'abilitiesAndResources'],
      trackingLevel: 'hard',
      promptPolicy: 'when_relevant',
      status: 'active',
      sourceChapterId: 'chapter-11',
      sourceChapterOrder: 11,
      evidence: '右手结晶化，成为与聚合体沟通的媒介。',
      confidence: 0.88,
      createdAt: timestamp,
      updatedAt: timestamp
    },
    proposedTransaction: null,
    beforeValue: null,
    afterValue: '右手结晶化，成为与聚合体沟通的媒介。',
    evidence: '右手结晶化，成为与聚合体沟通的媒介。',
    confidence: 0.88,
    riskLevel: 'high',
    status: 'pending',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  }
}

async function main() {
  await rm(outDir, { recursive: true, force: true })
  const { DecisionInboxService, groupDecisionInboxCandidates, listDecisionInboxGroups } = await loadService()

  const jobs = [{ id: 'job-11', projectId: 'project-1', targetChapterOrder: 11 }]
  const baseInput = {
    projectId: 'project-1',
    jobs,
    memoryCandidates: [memoryCandidate()],
    characterStateChangeCandidates: [stateCandidate()]
  }

  const sameEventGroups = groupDecisionInboxCandidates(baseInput)
  check(sameEventGroups.length === 1, '同章且同证据的两类候选聚合为一个事件组')
  check(
    sameEventGroups[0].memoryCandidateIds.join(',') === 'memory-1' &&
      sameEventGroups[0].characterStateCandidateIds.join(',') === 'state-1',
    '事件组保留两类候选各自的独立 ID'
  )
  check(sameEventGroups[0].candidateIds.length === 2, '聚合不吞掉底层候选引用')
  check(sameEventGroups[0].riskLevel === 'high', '事件风险采用组内最高风险')
  check(
    sameEventGroups[0].factCertainty === 'high' && sameEventGroups[0].factCertaintyScore > 0.8,
    '跨提取来源的同证据事件生成稳定事实确定性'
  )
  check(
    sameEventGroups[0].impactAreas.includes('character_state') && /角色状态/.test(sameEventGroups[0].impactSummary),
    '事件组提供作者可读的影响摘要'
  )

  const punctuationVariant = groupDecisionInboxCandidates({
    ...baseInput,
    characterStateChangeCandidates: [stateCandidate({ evidence: '右手结晶化，成为与聚合体沟通的媒介' })]
  })
  check(punctuationVariant.length === 1, '证据的标点与空白差异不会拆散同一事件')

  const crossChapter = groupDecisionInboxCandidates({
    ...baseInput,
    characterStateChangeCandidates: [stateCandidate({ chapterId: 'chapter-12', chapterOrder: 12 })]
  })
  check(crossChapter.length === 2, '相同证据跨章节不会聚合')

  const noEvidence = groupDecisionInboxCandidates({
    projectId: 'project-1',
    memoryCandidates: [
      memoryCandidate({ id: 'memory-empty-1', evidence: '' }),
      memoryCandidate({ id: 'memory-empty-2', evidence: '' })
    ],
    characterStateChangeCandidates: []
  })
  check(noEvidence.length === 2, '无证据候选不会因为同章或同类型被误合并')
  check(noEvidence.every((group) => group.factCertainty === 'low'), '无证据事件明确标为低事实确定性')

  const shuffledA = listDecisionInboxGroups({
    projectId: 'project-1',
    memoryCandidates: [
      memoryCandidate({ id: 'memory-9', evidence: '第九章证据', proposedPatch: { ...memoryCandidate().proposedPatch, sourceChapterOrder: 9, relatedChapterOrder: 9, relatedChapterId: 'chapter-9' }, updatedAt: '2026-09-06T09:00:00.000Z' }),
      memoryCandidate({ id: 'memory-12', evidence: '第十二章证据', proposedPatch: { ...memoryCandidate().proposedPatch, sourceChapterOrder: 12, relatedChapterOrder: 12, relatedChapterId: 'chapter-12' }, updatedAt: '2026-09-06T12:00:00.000Z' })
    ],
    characterStateChangeCandidates: [stateCandidate()]
  })
  const shuffledB = listDecisionInboxGroups({
    projectId: 'project-1',
    memoryCandidates: [...[
      memoryCandidate({ id: 'memory-12', evidence: '第十二章证据', proposedPatch: { ...memoryCandidate().proposedPatch, sourceChapterOrder: 12, relatedChapterOrder: 12, relatedChapterId: 'chapter-12' }, updatedAt: '2026-09-06T12:00:00.000Z' }),
      memoryCandidate({ id: 'memory-9', evidence: '第九章证据', proposedPatch: { ...memoryCandidate().proposedPatch, sourceChapterOrder: 9, relatedChapterOrder: 9, relatedChapterId: 'chapter-9' }, updatedAt: '2026-09-06T09:00:00.000Z' })
    ]],
    characterStateChangeCandidates: [stateCandidate()]
  })
  check(
    JSON.stringify(shuffledA.map((group) => group.id)) === JSON.stringify(shuffledB.map((group) => group.id)),
    '输入顺序变化时事件 ID 与列表顺序保持稳定'
  )
  check(shuffledA.map((group) => group.chapterOrder).join(',') === '12,11,9', '列表默认按较新章节稳定排序')
  check(DecisionInboxService.group === groupDecisionInboxCandidates && DecisionInboxService.list === listDecisionInboxGroups, '服务导出稳定的 group/list 门面')

  const oldData = listDecisionInboxGroups({
    projectId: 'project-1',
    jobs,
    memoryCandidates: [{
      id: 'legacy-memory',
      projectId: 'project-1',
      jobId: 'job-11',
      type: 'chapter_review',
      proposedPatch: { kind: 'legacy_raw' },
      evidence: '旧候选证据'
    }],
    characterStateChangeCandidates: [{
      id: 'legacy-state',
      projectId: 'project-1',
      jobId: 'job-11',
      characterId: 'character-1',
      evidence: '另一条旧候选证据'
    }]
  })
  check(oldData.length === 2 && oldData.every((group) => group.chapterOrder === 11), '旧数据缺少状态、时间和风险字段时可由 job 安全回填章节')
  check(oldData.every((group) => group.candidateIds.length === 1), '旧数据缺少字段不会被过度聚合')

  const filtered = listDecisionInboxGroups(baseInput, { riskLevels: ['high'], impactAreas: ['character_state'], limit: 1 })
  check(filtered.length === 1 && filtered[0].id === sameEventGroups[0].id, 'list API 支持稳定过滤和 limit')

  const acceptedExcluded = groupDecisionInboxCandidates({
    projectId: 'project-1',
    memoryCandidates: [memoryCandidate({ status: 'accepted' })],
    characterStateChangeCandidates: [stateCandidate({ status: 'rejected' })]
  })
  check(acceptedExcluded.length === 0, '服务只读取 pending 候选，不会让已处理记录重新出现')

  const foreignProjectExcluded = groupDecisionInboxCandidates({
    projectId: 'project-1',
    memoryCandidates: [memoryCandidate({ projectId: 'project-2' })],
    characterStateChangeCandidates: [stateCandidate({ projectId: 'project-2' })]
  })
  check(foreignProjectExcluded.length === 0, '不同项目候选严格隔离')

  const originalMemory = memoryCandidate()
  const originalState = stateCandidate()
  const snapshot = JSON.stringify([originalMemory, originalState])
  groupDecisionInboxCandidates({ projectId: 'project-1', memoryCandidates: [originalMemory], characterStateChangeCandidates: [originalState] })
  check(JSON.stringify([originalMemory, originalState]) === snapshot, 'group/list API 不修改输入候选，也不执行接受或写入')

  const [viewSource, appSource, shellSource, viewTypesSource, dashboardSource, memoryHookSource, testRunnerSource] = await Promise.all([
    readFile(join(repoRoot, 'src', 'renderer', 'src', 'views', 'DecisionInboxView.tsx'), 'utf8'),
    readFile(join(repoRoot, 'src', 'renderer', 'src', 'App.tsx'), 'utf8'),
    readFile(join(repoRoot, 'src', 'renderer', 'src', 'components', 'layoutParts', 'AppShell.tsx'), 'utf8'),
    readFile(join(repoRoot, 'src', 'renderer', 'src', 'components', 'layoutParts', 'types.ts'), 'utf8'),
    readFile(join(repoRoot, 'src', 'services', 'DirectorNextActionService.ts'), 'utf8'),
    readFile(join(repoRoot, 'src', 'renderer', 'src', 'views', 'generation', 'useMemoryCandidates.ts'), 'utf8'),
    readFile(join(repoRoot, 'scripts', 'run-tests.mjs'), 'utf8')
  ])
  check(
    viewTypesSource.includes("| 'inbox'") &&
      shellSource.includes("'dashboard', 'inbox', 'chapters'") &&
      appSource.includes("case 'inbox':") &&
      appSource.includes('<DecisionInboxView'),
    '决策收件箱拥有独立懒加载页面、导航入口和路由'
  )
  check(
    viewSource.includes('DecisionInboxService.list') &&
      viewSource.includes('previewCandidateDecisions') &&
      viewSource.includes('preview.requiresConfirmation') &&
      viewSource.includes('decisions: preview.items.map') &&
      viewSource.includes('executeCandidateDecision(command)') &&
      !viewSource.includes('CharacterStateService.applyStateChangeCandidate') &&
      !viewSource.includes('memoryActions.applyCandidate') &&
      viewSource.includes('逐条确认'),
    '收件箱按事件聚合展示，并通过共享候选决定命令处理整组或逐条操作'
  )
  check(
    dashboardSource.includes("destination: 'inbox'") &&
      dashboardSource.includes('pendingMemory.length + pendingState.length') &&
      dashboardSource.includes('打开决策收件箱'),
    'Dashboard 将记忆与角色状态待办合并为一个决策收件箱入口'
  )
  check(
    memoryHookSource.includes('candidateJob?.targetChapterOrder') &&
      memoryHookSource.includes("selectedJob?.id === item.candidate.jobId"),
    '跨章节收件箱按候选自己的 job 恢复章节顺序，不误用当前流水线选择'
  )
  check(testRunnerSource.includes('validate-decision-inbox-service.mjs'), 'npm test 包含决策收件箱回归验证')

  console.log('validate-decision-inbox-service: ok')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
