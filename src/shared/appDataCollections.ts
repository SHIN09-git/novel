import type { AppData } from './types/appData'

export type AppDataArrayKey = {
  [K in keyof AppData]: AppData[K] extends ReadonlyArray<unknown> ? K : never
}[keyof AppData]

export const PROJECT_SCOPED_COLLECTIONS = [
  'storyBibles',
  'chapters',
  'characters',
  'characterStateLogs',
  'characterStateFacts',
  'characterStateTransactions',
  'characterStateChangeCandidates',
  'foreshadowings',
  'timelineEvents',
  'stageSummaries',
  'promptVersions',
  'promptContextSnapshots',
  'storyDirectionGuides',
  'hardCanonPacks',
  'contextNeedPlans',
  'chapterContinuityBridges',
  'chapterGenerationJobs',
  'generatedChapterDrafts',
  'memoryUpdateCandidates',
  'candidateDecisionReceipts',
  'worldManagementReceipts',
  'consistencyReviewReports',
  'contextBudgetProfiles',
  'qualityGateReports',
  'generationRunTraces',
  'runTraceAuthorSummaries',
  'redundancyReports',
  'editorialVerdicts',
  'revisionCandidates',
  'revisionSessions',
  'quickRewriteDrafts',
  'chapterVersions',
  'chapterCommitBundles',
  'revisionCommitBundles',
  'agentRuns',
  'agentActionPreviews'
] as const satisfies readonly AppDataArrayKey[]

export const DEPENDENT_COLLECTIONS = [
  'chapterGenerationSteps',
  'revisionRequests',
  'revisionVersions'
] as const satisfies readonly AppDataArrayKey[]

export const ALL_ENTITY_COLLECTIONS = [
  'projects',
  ...PROJECT_SCOPED_COLLECTIONS,
  ...DEPENDENT_COLLECTIONS
] as const satisfies readonly AppDataArrayKey[]

export type ProjectScopedCollectionKey = (typeof PROJECT_SCOPED_COLLECTIONS)[number]
export type DependentCollectionKey = (typeof DEPENDENT_COLLECTIONS)[number]

export const APP_DATA_COLLECTION_LABELS = {
  projects: '项目',
  storyBibles: '小说圣经',
  chapters: '章节',
  characters: '角色',
  characterStateLogs: '角色状态日志',
  characterStateFacts: '动态状态账本',
  characterStateTransactions: '状态账本变更',
  characterStateChangeCandidates: '状态变化候选',
  foreshadowings: '伏笔',
  timelineEvents: '时间线事件',
  stageSummaries: '阶段摘要',
  promptVersions: 'Prompt 版本',
  promptContextSnapshots: '上下文快照',
  storyDirectionGuides: '剧情导向',
  hardCanonPacks: '硬设定包',
  contextNeedPlans: '上下文需求计划',
  chapterContinuityBridges: '章节衔接',
  chapterGenerationJobs: '生产流水线任务',
  chapterGenerationSteps: '生产流水线步骤',
  generatedChapterDrafts: '章节草稿',
  memoryUpdateCandidates: '记忆更新候选',
  candidateDecisionReceipts: '候选决定记录',
  worldManagementReceipts: '世界资料管理记录',
  consistencyReviewReports: '一致性报告',
  contextBudgetProfiles: '上下文预算',
  qualityGateReports: '质量门禁报告',
  generationRunTraces: '生成追踪',
  runTraceAuthorSummaries: '生成诊断摘要',
  redundancyReports: '冗余报告',
  editorialVerdicts: '编辑审稿结论',
  revisionCandidates: '修订候选',
  revisionSessions: '修订会话',
  revisionRequests: '修订请求',
  revisionVersions: '修订版本',
  quickRewriteDrafts: '快捷重写暂存',
  chapterVersions: '章节历史版本',
  chapterCommitBundles: '章节提交记录',
  revisionCommitBundles: '修订提交记录',
  agentRuns: 'Agent 批次',
  agentActionPreviews: 'Agent 操作预览'
} satisfies Record<AppDataArrayKey, string>

export function collectionName(collection: AppDataArrayKey): string {
  return APP_DATA_COLLECTION_LABELS[collection]
}
