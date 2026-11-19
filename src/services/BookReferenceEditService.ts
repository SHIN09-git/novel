import { createEmptyBible } from '../shared/defaults'
import type { AppData, StageSummary, StoryBible, WorldManagementReceipt } from '../shared/types'
import { decisionFingerprint } from './candidateDecisionPrimitives'

export const STORY_BIBLE_FIELDS = [
  'worldbuilding', 'corePremise', 'protagonistDesire', 'protagonistFear', 'mainConflict',
  'powerSystem', 'bannedTropes', 'styleSample', 'narrativeTone', 'immutableFacts'
] as const satisfies readonly (keyof StoryBible)[]
export const STAGE_SUMMARY_FIELDS = [
  'chapterStart', 'chapterEnd', 'compressedPlotSummary', 'irreversibleChanges',
  'endingCarryoverState', 'emotionalAftertaste', 'pacingState'
] as const satisfies readonly (keyof StageSummary)[]
type ReferenceEntity = 'story_bible' | 'stage_summary'
type Reference = StoryBible | StageSummary
export type BookReferenceChange = {
  projectId: string; operationId: string; reason: string
} & ({ entity: ReferenceEntity; summaryId?: string; patch: Record<string, unknown> } | { restoreOperationId: string })

function asRecord(item: Reference | null): Record<string, unknown> | null {
  return item === null ? null : { ...item }
}

function withoutEditTime(record: Record<string, unknown> | null) {
  if (!record) return null
  const { updatedAt: _editTime, ...content } = record
  return content
}

function object(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('资料内容必须是对象。')
  return value as Record<string, unknown>
}

function verifyPatch(patch: Record<string, unknown>, allowed: readonly string[], integers: readonly string[] = []) {
  for (const [key, value] of Object.entries(patch)) {
    if (!allowed.includes(key)) throw new Error(`不支持的资料字段：${key}。`)
    if (integers.includes(key)) {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new Error(`${key} 必须是正整数。`)
    } else if (typeof value !== 'string') throw new Error(`${key} 必须是文本。`)
  }
}

export function editStoryBible(base: StoryBible | null, projectId: string, patch: unknown, updatedAt: string): StoryBible {
  const fields = object(patch)
  verifyPatch(fields, STORY_BIBLE_FIELDS)
  return { ...(base ?? createEmptyBible(projectId)), ...fields, projectId, updatedAt }
}

function editStageSummary(base: StageSummary | null, projectId: string, id: string, patch: Record<string, unknown>, at: string): StageSummary {
  verifyPatch(patch, STAGE_SUMMARY_FIELDS, ['chapterStart', 'chapterEnd'])
  if (!base && (patch.chapterStart === undefined || patch.chapterEnd === undefined)) {
    throw new Error('创建阶段摘要需要 chapterStart、chapterEnd。')
  }
  const record = { chapterStart: 1, chapterEnd: 1, plotProgress: '', characterRelations: '', secrets: '',
    foreshadowingPlanted: '', foreshadowingResolved: '', unresolvedQuestions: '', nextStageDirection: '',
    compressedPlotSummary: '', irreversibleChanges: '', endingCarryoverState: '', emotionalAftertaste: '', pacingState: '',
    createdAt: at, ...base, ...patch, id, projectId, updatedAt: at } as StageSummary
  if (record.chapterStart > record.chapterEnd) throw new Error('阶段摘要起始章不能大于结束章。')
  return { ...record, coveredChapterRange: `第 ${record.chapterStart}-${record.chapterEnd} 章`,
    plotProgress: 'compressedPlotSummary' in patch ? record.compressedPlotSummary ?? '' : record.plotProgress }
}

export function bookReferenceEdit(data: AppData, change: BookReferenceChange, at: string) {
  const { projectId, operationId, reason } = change
  const commandHash = decisionFingerprint(change)
  const prior = data.worldManagementReceipts.find(item => item.projectId === projectId && item.operationId === operationId)
  if (prior) {
    if (prior.commandFingerprint !== commandHash || !['story_bible', 'stage_summary'].includes(prior.entity)) {
      throw new Error('同一操作编号不能用于不同的资料改动。')
    }
    return { after: prior.after.removed === true ? null : prior.after, before: prior.before,
      fingerprint: prior.previewFingerprint, receipt: prior, data, replayed: true }
  }
  const restoring = 'restoreOperationId' in change
  const restore = restoring
    ? data.worldManagementReceipts.find(item => item.projectId === projectId && item.operationId === change.restoreOperationId) : null
  if (restoring && (!restore || (restore.entity !== 'story_bible' && restore.entity !== 'stage_summary'))) {
    throw new Error('本书没有该小说圣经或阶段摘要改动记录。')
  }
  const entity = (restoring ? restore!.entity : change.entity) as ReferenceEntity
  const id = entity === 'story_bible' ? projectId
    : restoring ? restore!.targetId : change.summaryId ?? `agent-stage-${decisionFingerprint([projectId, operationId])}`
  const before = entity === 'story_bible' ? data.storyBibles.find(item => item?.projectId === projectId) ?? null
    : data.stageSummaries.find(item => item.id === id && item.projectId === projectId) ?? null
  let after: Reference | null
  if (restore) {
    const expected = restore.after.removed === true ? null : restore.after
    if (decisionFingerprint(withoutEditTime(expected)) !== decisionFingerprint(withoutEditTime(asRecord(before)))) {
      throw new Error('资料后来已改动。旧回退会覆盖新内容，请按当前版本重新编辑。')
    }
    after = restore.before
      ? { ...restore.before, projectId, ...(entity === 'stage_summary' ? { id } : {}), updatedAt: at } as unknown as Reference
      : null
  } else if (!restoring) {
    if (!Object.keys(change.patch).length) throw new Error('至少提供一项要改动的字段。')
    if (entity === 'story_bible') after = editStoryBible(before as StoryBible | null, projectId, change.patch, at)
    else {
      if (change.summaryId && !before) throw new Error('本书没有指定的阶段摘要。')
      if (!change.summaryId && data.stageSummaries.some(item => item.id === id)) throw new Error('阶段摘要编号已存在。')
      after = editStageSummary(before as StageSummary | null, projectId, id, change.patch, at)
    }
  } else throw new Error('无可回退的资料版本。')

  const fingerprint = decisionFingerprint({ commandHash, before, restore: restore?.id })
  const projects = data.projects.map(item => item.id === projectId ? { ...item, updatedAt: at } : item)
  const next = entity === 'story_bible' ? {
    ...data, projects,
    storyBibles: [...data.storyBibles.filter(item => item?.projectId !== projectId), ...(after ? [after as StoryBible] : [])]
  } : withStageSummary(data, projects, projectId, id, after as StageSummary | null)
  const receipt: Omit<WorldManagementReceipt, 'authorizationGrantId'> = {
    id: `book-reference-${decisionFingerprint([projectId, operationId])}`, projectId, operationId, entity,
    targetId: id, action: restoring ? 'restore' : before ? 'update' : 'create', before: asRecord(before),
    after: asRecord(after) ?? { id, removed: true },
    source: { kind: 'agent_director', reason, ...(restore ? { restoredFromOperationId: restore.operationId } : {}) },
    commandFingerprint: commandHash, previewFingerprint: fingerprint, createdAt: at, schemaVersion: 1
  }
  return { after: asRecord(after), before: asRecord(before), fingerprint, receipt, data: next, replayed: false }
}

function withStageSummary(data: AppData, projects: AppData['projects'], projectId: string, id: string, after: StageSummary | null) {
  const stageSummaries = [...data.stageSummaries.filter(item => item.id !== id || item.projectId !== projectId), ...(after ? [after] : [])]
  const coverage = stageSummaries.filter(item => item.projectId === projectId)
  const chapters = data.chapters.map(chapter => {
    if (chapter.projectId !== projectId) return chapter
    const includedInStageSummary = coverage.some(item => item.chapterStart <= chapter.order && item.chapterEnd >= chapter.order)
    return chapter.includedInStageSummary === includedInStageSummary ? chapter : { ...chapter, includedInStageSummary }
  })
  return { ...data, projects, stageSummaries, chapters }
}
